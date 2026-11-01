let buffer;

// An intentionally simple digital form: the same eye palette and personality,
// with no bitmap or model call needed for an immediate listening reaction.
export function drawEyes(
  ctx,
  { now, state, emotion, gazeX = 0, gazeY = 0, level = 0 },
) {
  ctx.save();
  ctx.fillStyle = "#160b26";
  ctx.strokeStyle = "#a96eff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-220, -100);
  ctx.lineTo(178, -121);
  ctx.lineTo(220, -85);
  ctx.lineTo(207, 104);
  ctx.lineTo(-180, 119);
  ctx.lineTo(-226, 75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const sleeping = state === "sleeping",
    blink = sleeping || now % 4300 < 125;
  for (const x of [-102, 102]) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.scale(1, blink ? 0.08 : 1);
    ctx.strokeStyle = "#80edf3";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.ellipse(0, 0, 74, 70, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#aa75ff";
    ctx.beginPath();
    ctx.arc(gazeX * 15, gazeY * 12, 43, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#24143f";
    ctx.beginPath();
    ctx.arc(gazeX * 15, gazeY * 12, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e5d9ff";
    ctx.fillRect(gazeX * 15 + 10, gazeY * 12 - 22, 10, 10);
    ctx.restore();
  }
  if (["concerned", "confused", "focused"].includes(emotion)) {
    ctx.strokeStyle = "#c8a5ff";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(-177, -77);
    ctx.lineTo(-40, -62);
    ctx.moveTo(38, -62);
    ctx.lineTo(177, -88);
    ctx.stroke();
  }
  if (["happy", "playful"].includes(emotion) || state === "speaking") {
    ctx.strokeStyle = "#eadaff";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-42, 82);
    ctx.lineTo(-20, 92 + level * 50);
    ctx.lineTo(0, 81);
    ctx.lineTo(20, 92 + level * 50);
    ctx.lineTo(42, 81);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSignalGlitch(ctx, canvas, now, amount) {
  if (amount <= 0) return;
  buffer ||= document.createElement("canvas");
  if (buffer.width !== canvas.width || buffer.height !== canvas.height) {
    buffer.width = canvas.width;
    buffer.height = canvas.height;
  }
  const copy = buffer.getContext("2d");
  copy.clearRect(0, 0, buffer.width, buffer.height);
  copy.drawImage(canvas, 0, 0);
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const y = 80 + ((Math.floor(now / 33) * 37 + i * 137) % 620),
      h = 4 + i * 2;
    const dx = (i % 2 ? 1 : -1) * amount * (8 + i * 3);
    ctx.clearRect(0, y, canvas.width, h);
    ctx.drawImage(buffer, 0, y, canvas.width, h, dx, y, canvas.width, h);
  }
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(212,248,255,${amount * 0.35})`;
  for (let i = 0; i < 42; i++) {
    const seed = Math.floor(now / 66) + i * 71;
    ctx.fillRect(
      (seed * 97) % canvas.width,
      (seed * 193) % canvas.height,
      2,
      2,
    );
  }
  ctx.restore();
}
