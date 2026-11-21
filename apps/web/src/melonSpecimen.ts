// Three sample numbers etched into the guest optic. Both renderers use the
// same transparent decal atlas. No ticket identifier enters the guest scene.
export function specimenDecals() {
  const cell = 160;
  const sheet = document.createElement("canvas");
  sheet.width = cell * 3;
  sheet.height = cell;
  const ctx = sheet.getContext("2d")!;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(i * cell, 0);
    ctx.strokeStyle = "#3c2448";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        ctx.moveTo(35 + 13 * x, 35 + 5 * y);
        ctx.lineTo(35 + 13 * x, 35 + 13 * y);
        ctx.lineTo(35 + 5 * x, 35 + 13 * y);
      }
    ctx.stroke();
    ctx.fillStyle = "#35243f";
    ctx.beginPath();
    ctx.ellipse(35, 35, 3.2, 5.2, 0.64, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 49px monospace";
    ctx.fillText("0" + (i + 1), 20, 132);
    for (let k = 0; k <= i; k++) ctx.fillRect(133 - k * 8, 113, 3, 17);
    ctx.restore();
  }
  return sheet;
}
