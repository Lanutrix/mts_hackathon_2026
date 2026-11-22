export type ShiftOwner = { owner: string | null; version: number };
export type ShiftTicket = ShiftOwner & {
  id: string;
  header: string;
  suggested: string | null;
  basis: string;
  cluster: string;
  model: boolean;
};
export type ShiftView = {
  runId: string;
  members: { name: string; active: boolean; taken: number; suggested: number }[];
  rows: ShiftTicket[];
  total: number;
  ticket: ShiftTicket | null;
};
export type ShiftTab = "suggested" | "mine" | "team";
