"""Rebuild the UCI 498 aggregate training profile and chronological evaluation."""
import argparse
import csv
import hashlib
import io
import json
import math
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean, variance

ROOT = Path(__file__).resolve().parents[1]
URL = "https://archive.ics.uci.edu/static/public/498/incident+management+process+enriched+event+log.zip"
DOI = "https://doi.org/10.24432/C57S4H"
START = datetime(2016, 3, 1)
SPLIT = datetime(2016, 5, 1)
END = datetime(2016, 6, 1)
HOUR = timedelta(hours=1)
CATEGORY_PRIOR = 24
GROUP_PRIOR = 12


def slot(stamp):
    return stamp.hour + 24 * (stamp.weekday() >= 5)


def hours(start, end):
    while start < end:
        yield start
        start += HOUR


def get_cases(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        content = archive.read("incident_event_log.csv")
    first = {}
    records = 0
    for row in csv.DictReader(io.StringIO(content.decode("utf-8-sig"))):
        records += 1
        key = row["number"]
        # The smallest update counter identifies the earliest available snapshot.
        # CSV order breaks equal-counter ties without consulting later assignments.
        version = int(row["sys_mod_count"])
        if key not in first or first[key][0] > version:
            first[key] = (version, row["opened_at"], row["category"],
                          row["assignment_group"], int(row["priority"][0]))
    cases = [(datetime.strptime(stamp, "%d/%m/%Y %H:%M"), category, group, priority)
             for _, stamp, category, group, priority in first.values()]
    return cases, records, hashlib.sha256(content).hexdigest()


def fit(train):
    exposure = Counter(slot(h) for h in hours(START, SPLIT))
    days = {h.date(): [0] * 24 for h in hours(START, SPLIT) if h.hour == 0}
    by_slot = defaultdict(Counter)
    by_category = defaultdict(Counter)
    groups = Counter()
    priorities = Counter()
    for stamp, category, group, priority in train:
        days[stamp.date()][stamp.hour] += 1
        by_slot[slot(stamp)][category] += 1
        by_category[category][group] += 1
        groups[group] += 1
        priorities[priority] += 1
    categories = sorted(by_category)
    labels = sorted(groups) + ["<unseen>"]
    return {
        "source": DOI,
        "trainStart": START.date().isoformat(),
        "trainEndExclusive": SPLIT.date().isoformat(),
        "categoryPriorWeight": CATEGORY_PRIOR,
        "groupPriorWeight": GROUP_PRIOR,
        "exposureDays": [exposure[0], exposure[24]],
        "daysByType": [[counts for day, counts in days.items() if (day.weekday() >= 5) == weekend]
                       for weekend in (False, True)],
        "categories": categories,
        "groups": labels,
        "categoryCountsBySlot": [[by_slot[i][c] for c in categories] for i in range(48)],
        "groupCountsByCategory": [[by_category[c][g] for g in labels] for c in categories],
        "priorityCounts": [priorities[i] for i in range(1, 5)],
    }


def evaluate(train, test, model, all_cases):
    category_index = {c: i for i, c in enumerate(model["categories"])}
    group_index = {g: i for i, g in enumerate(model["groups"])}
    category_groups = model["groupCountsByCategory"]
    group_totals = [sum(col) for col in zip(*category_groups)]
    prior = [(n + 0.5) / (len(train) + len(group_totals) / 2) for n in group_totals]
    group_losses, baseline_losses = [], []
    group_hits = baseline_hits = 0
    top_group = max(range(len(prior)), key=prior.__getitem__)
    for _, category, group, _ in test:
        idx = group_index.get(group, len(prior) - 1)
        counts = category_groups[category_index[category]] if category in category_index else [0] * len(prior)
        weights = [count + GROUP_PRIOR * p for count, p in zip(counts, prior)]
        group_losses.append(-math.log(weights[idx] / sum(weights)))
        baseline_losses.append(-math.log(prior[idx]))
        group_hits += idx == max(range(len(weights)), key=weights.__getitem__)
        baseline_hits += idx == top_group
    labels = model["groups"]
    slots = model["categoryCountsBySlot"]
    rates = [sum(row) / model["exposureDays"][i // 24] for i, row in enumerate(slots)]
    observed = Counter(stamp.replace(minute=0) for stamp, *_ in all_cases)
    test_hours = list(hours(SPLIT, END))
    flat = len(train) / ((SPLIT - START) / HOUR)

    def errors(predictions, stamps):
        return round(mean(abs(pred - observed[h]) for pred, h in zip(predictions, stamps)), 4)

    category_totals = [sum(row) for row in category_groups]
    group_mix_by_slot = []
    for counts in slots:
        category_probs = [(n + CATEGORY_PRIOR * total / len(train)) / (sum(counts) + CATEGORY_PRIOR)
                          for n, total in zip(counts, category_totals)]
        group_mix_by_slot.append([
            sum(p * (row[g] + GROUP_PRIOR * prior[g]) / (total + GROUP_PRIOR)
                for p, row, total in zip(category_probs, category_groups, category_totals))
            for g in range(len(labels))])
    observed_groups = Counter((stamp.replace(minute=0), group) for stamp, _, group, _ in test)
    joint = {}
    known_groups = [i for i, label in enumerate(labels) if label.startswith("Group ")]
    for g in sorted(known_groups, key=group_totals.__getitem__, reverse=True)[:3]:
        joint[labels[g]] = {
            "testArrivals": sum(observed_groups[h, labels[g]] for h in test_hours),
            "calendarCategoryMae": round(mean(abs(rates[slot(h)] * group_mix_by_slot[slot(h)][g]
                                                    - observed_groups[h, labels[g]]) for h in test_hours), 4),
            "calendarGlobalMixMae": round(mean(abs(rates[slot(h)] * prior[g] - observed_groups[h, labels[g]])
                                                for h in test_hours), 4),
            "constantHourlyGroupMae": round(mean(abs(flat * prior[g] - observed_groups[h, labels[g]])
                                                 for h in test_hours), 4),
        }
    totals = [observed[h] for h in test_hours]
    later = list(hours(END, max(stamp for stamp, *_ in all_cases).replace(hour=0, minute=0)))
    peak = max(range(24), key=rates.__getitem__)
    covered = 0
    for h in test_hours:
        values = sorted(d[h.hour] for d in model["daysByType"][int(h.weekday() >= 5)])
        low, high = (values[math.ceil(q * len(values)) - 1] for q in (0.1, 0.9))
        covered += low <= observed[h] <= high
    return {
        "testHours": len(test_hours),
        "hourlyMae": {"calendar": errors([rates[slot(h)] for h in test_hours], test_hours),
                      "constantTrainMean": errors([flat] * len(test_hours), test_hours),
                      "previousWeek": errors([observed[h - timedelta(days=7)] for h in test_hours], test_hours)},
        "predictedTestArrivals": round(sum(rates[slot(h)] for h in test_hours), 2),
        "trainMeanPerHour": round(flat, 4),
        "trainDailyWeekdayWeekend": [round(sum(rates[s:s+24]), 2) for s in (0, 24)],
        "trainPeakWeekdayHour": peak,
        "trainPeakWeekdayRate": round(rates[peak], 2),
        "empirical10to90InclusiveCoverage": round(covered / len(test_hours), 4),
        "hourlyVarianceToMeanInTest": round(variance(totals) / mean(totals), 3),
        "pearsonDispersionInTest": round(mean((observed[h] - rates[slot(h)]) ** 2 / rates[slot(h)]
                                               for h in test_hours if rates[slot(h)] > 0), 3),
        "outsideRegimeHourlyMae": {"hours": len(later), "arrivals": sum(observed[h] for h in later),
                                   "endExclusive": (later[-1] + HOUR).date().isoformat(),
                                   "calendar": errors([rates[slot(h)] for h in later], later),
                                   "constantTrainMean": errors([flat] * len(later), later)},
        "groupLogLossNats": {"givenCategory": round(mean(group_losses), 4),
                             "globalMix": round(mean(baseline_losses), 4)},
        "groupTop1Accuracy": {"givenCategory": round(group_hits / len(test), 4),
                              "globalMix": round(baseline_hits / len(test), 4)},
        "topThreeHourlyGroupLoads": joint,
        "knownTrainGroups": len(labels) - 2,
        "trainUnknownAssignment": group_totals[group_index["?"]],
        "testUnknownAssignment": sum(g == "?" for _, _, g, _ in test),
        "testUnseenGroup": sum(g not in group_index for _, _, g, _ in test),
        "topTrainGroup": labels[top_group],
        "topTrainShare": round(group_totals[top_group] / len(train), 4),
        "topTestShare": round(sum(g == labels[top_group] for _, _, g, _ in test) / len(test), 4),
    }


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Local copy of the official UCI zip")
    args = parser.parse_args()
    blob = args.archive.read_bytes() if args.archive else urllib.request.urlopen(URL, timeout=60).read()
    cases, events, checksum = get_cases(blob)
    train = [case for case in cases if START <= case[0] < SPLIT]
    test = [case for case in cases if SPLIT <= case[0] < END]
    model = fit(train)
    result = {"source": DOI, "csvSha256": checksum, "rawEvents": events, "uniqueIncidents": len(cases),
              "trainingIncidents": len(train), "testIncidents": len(test),
              "excludedBeforeTraining": sum(c[0] < START for c in cases),
              "afterTest": sum(c[0] >= END for c in cases),
              "trainingStart": START.date().isoformat(), "testStart": SPLIT.date().isoformat(),
              "testEndExclusive": END.date().isoformat(), **evaluate(train, test, model, cases)}
    write_json(ROOT / "apps/server/arrivalProfile.json", model)
    (ROOT / "docs/qa/evidence/incident-arrival-validation.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
