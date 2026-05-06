const canvas = document.getElementById("circuitCanvas");
const ctx = canvas.getContext("2d");

let nodes = [];
let components = [];

let tool = null;
let selectedNode = null;
let draggingNode = null;
let isDragging = false;
let hoverNode = null;
let wireDraft = null;

let animPhase = 0;
let animating = false;

const NODE_RADIUS = 6;

// ---------------------- TOOLBAR ----------------------

document.querySelectorAll("#toolbar button").forEach(btn => {
  btn.onclick = () => {
    tool = btn.dataset.tool;
    selectedNode = null;
    wireDraft = null;
  };
});

// ---------------------- MOUSE EVENTS ----------------------

canvas.addEventListener("mousedown", e => {
  const {x, y} = getMouse(e);
  const node = findNearestNode(x, y, 10);

  // DELETE TOOL
  if (tool === "delete") {
    const comp = findNearestComponent(x, y);
    if (comp) {
      components = components.filter(c => c !== comp);
      draw();
      return;
    }

    if (node) {
      const deletedId = node.id;

      nodes = nodes.filter(n => n !== node);
      nodes.forEach((n, i) => n.id = i);

      components = components.filter(c =>
        !(c.n1 === deletedId || c.n2 === deletedId)
      );

      components.forEach(c => {
        if (c.n1 > deletedId) c.n1--;
        if (c.n2 > deletedId) c.n2--;
      });

      draw();
    }
    return;
  }

  // EDIT TOOL
  if (tool === "edit") {
    const comp = findNearestComponent(x, y);
    if (comp) {
      if (comp.type === "resistor") {
        const newVal = prompt("Enter resistance (ohms):", comp.value);
        if (newVal !== null) comp.value = parseFloat(newVal);
      }
      if (comp.type === "capacitor") {
        const newVal = prompt("Enter capacitance (farads):", comp.value);
        if (newVal !== null) comp.value = parseFloat(newVal);
      }
      if (comp.type === "inductor") {
        const newVal = prompt("Enter inductance (henrys):", comp.value);
        if (newVal !== null) comp.value = parseFloat(newVal);
      }
      if (comp.type === "voltage") {
        const newVal = prompt("Enter voltage (V):", comp.value);
        if (newVal !== null) comp.value = parseFloat(newVal);
      }
      if (comp.type === "current") {
        const newVal = prompt("Enter current (A):", comp.value);
        if (newVal !== null) comp.value = parseFloat(newVal);
      }
      draw();
    }
    return;
  }

  // NODE TOOL
  if (tool === "node") {
    if (node) {
      draggingNode = node;
      isDragging = true;
    } else {
      nodes.push({ id: nodes.length, x, y });
      draw();
    }
    return;
  }

  // ROTATE TOOL
  if (tool === "rotate") {
    const comp = findNearestComponent(x, y);
    if (comp && comp.type !== "wire") {
      comp.rotation = ((comp.rotation || 0) + 90) % 360;
      draw();
    }
    return;
  }

  // WIRE TOOL
  if (tool === "wire") {
    if (!wireDraft) {
      if (node) wireDraft = { startNode: node.id };
    } else {
      if (node) {
        components.push({
          type: "wire",
          n1: wireDraft.startNode,
          n2: node.id,
          value: 0,
          rotation: 0
        });
      }
      wireDraft = null;
      draw();
    }
    return;
  }

  // GROUND TOOL
  if (tool === "ground") {
    if (node) {
      components.push({
        type: "ground",
        n1: node.id,
        n2: -1
      });
      draw();
    }
    return;
  }

  // RESISTOR TOOL
  if (tool === "resistor" && node) {
    if (!selectedNode) {
      selectedNode = node;
    } else if (selectedNode.id !== node.id) {
      components.push({
        type: "resistor",
        n1: selectedNode.id,
        n2: node.id,
        value: 1000,
        rotation: 0
      });
      selectedNode = null;
      draw();
    }
    return;
  }

  // CAPACITOR TOOL
  if (tool === "capacitor" && node) {
    if (!selectedNode) {
      selectedNode = node;
    } else if (selectedNode.id !== node.id) {
      components.push({
        type: "capacitor",
        n1: selectedNode.id,
        n2: node.id,
        value: 1e-6,
        rotation: 0
      });
      selectedNode = null;
      draw();
    }
    return;
  }

  // INDUCTOR TOOL
  if (tool === "inductor" && node) {
    if (!selectedNode) {
      selectedNode = node;
    } else if (selectedNode.id !== node.id) {
      components.push({
        type: "inductor",
        n1: selectedNode.id,
        n2: node.id,
        value: 1e-3,
        rotation: 0
      });
      selectedNode = null;
      draw();
    }
    return;
  }

  // VOLTAGE TOOL
  if (tool === "voltage" && node) {
    if (!selectedNode) {
      selectedNode = node;
    } else if (selectedNode.id !== node.id) {
      components.push({
        type: "voltage",
        n1: selectedNode.id,
        n2: node.id,
        value: 5,
        rotation: 0
      });
      selectedNode = null;
      draw();
    }
    return;
  }

  // CURRENT TOOL
  if (tool === "current" && node) {
    if (!selectedNode) {
      selectedNode = node;
    } else if (selectedNode.id !== node.id) {
      components.push({
        type: "current",
        n1: selectedNode.id,
        n2: node.id,
        value: 1,
        rotation: 0
      });
      selectedNode = null;
      draw();
    }
    return;
  }
});

canvas.addEventListener("mousemove", e => {
  const {x, y} = getMouse(e);
  hoverNode = findNearestNode(x, y, 10);

  if (isDragging && draggingNode) {
    draggingNode.x = x;
    draggingNode.y = y;
    draw();
  }
});

canvas.addEventListener("mouseup", () => {
  draggingNode = null;
  isDragging = false;
});

// ---------------------- SOLVE BUTTON ----------------------

document.querySelector('[data-tool="solve"]').onclick = () => {
  if (animating) {
    animating = false;
    document.querySelector('[data-tool="solve"]').textContent = "Start DC Simulation";
  } else {
    if (nodes.length === 0) return;

    const V = solveDC(nodes, components);
    const sourceCurrents = V.slice(nodes.length);
    const voltageSources = components.filter(c => c.type === "voltage");
    voltageSources.forEach((vs, i) => vs.current = sourceCurrents[i]);
    computeCurrents(components, V.slice(0, nodes.length));
    draw();

    animating = true;
    document.querySelector('[data-tool="solve"]').textContent = "Stop Simulation";
  }
};

// ---------------------- HELPERS ----------------------

function getMouse(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function findNearestNode(x, y, r) {
  return nodes.find(n => Math.hypot(n.x - x, n.y - y) < r);
}

function findNearestComponent(x, y) {
  let best = null;
  let bestDist = Infinity;

  components.forEach(c => {
    const n1 = nodes[c.n1];
    const n2 = nodes[c.n2];
    if (!n1 || !n2) return;

    const dist = distanceToLineSegment(x, y, n1.x, n1.y, n2.x, n2.y);
    if (dist < bestDist && dist < 10) {
      bestDist = dist;
      best = c;
    }
  });

  return best;
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

// ---------------------- DRAWING ----------------------

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  components.forEach(c => {
    const n1 = nodes[c.n1];
    
    if (c.type === "ground") {
      if (n1) drawGround(n1);
      return;
    }
    
    const n2 = nodes[c.n2];
    if (!n1 || !n2) return;

    if (c.type === "wire") {
      drawWire(n1, n2, c.current);
    }
    if (c.type === "resistor") {
      drawResistor(n1, n2, `R=${c.value}Ω`, c.current, c.rotation);
    }
    if (c.type === "capacitor") {
      drawCapacitor(n1, n2, `C=${c.value}F`, c.current, c.rotation);
    }
    if (c.type === "inductor") {
      drawInductor(n1, n2, `L=${c.value}H`, c.current, c.rotation);
    }
    if (c.type === "voltage") {
      drawVoltageSource(n1, n2, `${c.value}V, ${c.current ? c.current.toFixed(3) : 0}A`, c.rotation);
    }
    if (c.type === "current") {
      drawCurrentSource(n1, n2, `${c.value}A, ${c.voltageDrop ? c.voltageDrop.toFixed(3) : 0}V`, c.rotation, c.value);
    }
  });

  nodes.forEach(n => drawNode(n));
}

function drawNode(n) {
  ctx.beginPath();
  ctx.arc(n.x, n.y, NODE_RADIUS, 0, 2 * Math.PI);
  ctx.fillStyle = hoverNode === n ? "orange" : "black";
  ctx.fill();
  ctx.fillText("N" + n.id, n.x + 8, n.y - 8);
}

function drawWire(n1, n2, current) {
  ctx.beginPath();
  ctx.moveTo(n1.x, n1.y);
  ctx.lineTo(n2.x, n2.y);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawCurrentDot(n1.x, n1.y, n2.x, n2.y, current);
}

function drawResistor(n1, n2, label, current, rotation) {
  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);

  const ux = dx / L;
  const uy = dy / L;

  const px = -uy;
  const py = ux;

  const zigCount = 6;
  const zigSize = 6;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const startZig = L / 3;
  const endZig = 2 * L / 3;
  const zigSpan = endZig - startZig;
  const segment = zigSpan / zigCount;

  ctx.beginPath();

  // Straight line from node to zigzag start
  let pStart = rotatePoint(x1 + ux * startZig, y1 + uy * startZig, mx, my, rotation);
  ctx.moveTo(x1, y1);
  ctx.lineTo(pStart.x, pStart.y);

  // Zigzag section
  for (let i = 0; i <= zigCount; i++) {
    const t = startZig + i * segment;
    const bx = x1 + ux * t;
    const by = y1 + uy * t;
    const offset = (i % 2 === 0 ? -1 : 1) * zigSize;
    const zx = bx + px * offset;
    const zy = by + py * offset;
    const p = rotatePoint(zx, zy, mx, my, rotation);
    ctx.lineTo(p.x, p.y);
  }

  // Straight line from zigzag end to node
  let pEnd = rotatePoint(x2 - ux * (L - endZig), y2 - uy * (L - endZig), mx, my, rotation);
  ctx.lineTo(x2, y2);

  ctx.strokeStyle = current != null ? (current > 0 ? "red" : "blue") : "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "black";
  ctx.font = "12px Arial";
  ctx.fillText(label, mx + px * 40, my + py * 40);
  if (current != null) {
    ctx.fillText(current.toFixed(3) + " A", mx + px * 40, my + py * 75);
  }

  drawCurrentDot(n1.x, n1.y, n2.x, n2.y, current);
}

function drawVoltageSource(n1, n2, label, rotation = 0) {
  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);

  const ux = dx / L;
  const uy = dy / L;

  const radius = 12;
  const lead = (L / 2) - radius;

  const ax = x1 + ux * lead;
  const ay = y1 + uy * lead;
  const bx = x2 - ux * lead;
  const by = y2 - uy * lead;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(ax, ay);
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = "purple";
  ctx.lineWidth = 2;
  ctx.stroke();

  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  ctx.beginPath();
  ctx.arc(mx, my, radius, 0, 2 * Math.PI);
  ctx.stroke();

  const px = -uy;
  const py = ux;
  ctx.fillStyle = "purple";
  ctx.font = "12px Arial";
  ctx.fillText(label, mx + px * 40, my + py * 40);

  // Draw polarity
  const offset = 15;
  ctx.fillStyle = "purple";
  ctx.font = "12px Arial";
  ctx.fillText("+", n1.x - ux * offset, n1.y - uy * offset);
  ctx.fillText("-", n2.x + ux * offset, n2.y + uy * offset);
}

function drawCurrentSource(n1, n2, label, rotation = 0, currentValue) {
  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);

  const ux = dx / L;
  const uy = dy / L;

  const radius = 12;
  const lead = (L / 2) - radius;

  const ax = x1 + ux * lead;
  const ay = y1 + uy * lead;
  const bx = x2 - ux * lead;
  const by = y2 - uy * lead;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(ax, ay);
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = "green";
  ctx.lineWidth = 2;
  ctx.stroke();

  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  ctx.beginPath();
  ctx.arc(mx, my, radius, 0, 2 * Math.PI);
  ctx.stroke();

  // Draw arrow
  const arrowLength = 8;
  const arrowX = mx + ux * (radius - 2);
  const arrowY = my + uy * (radius - 2);
  ctx.beginPath();
  ctx.moveTo(arrowX - ux * arrowLength, arrowY - uy * arrowLength);
  ctx.lineTo(arrowX, arrowY);
  ctx.lineTo(arrowX - uy * 4, arrowY + ux * 4);
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX + uy * 4, arrowY - ux * 4);
  ctx.stroke();

  const px = -uy;
  const py = ux;
  ctx.fillStyle = "green";
  ctx.font = "12px Arial";
  ctx.fillText(label, mx + px * 40, my + py * 40);

  drawCurrentDot(n1.x, n1.y, n2.x, n2.y, currentValue);
}

function drawCapacitor(n1, n2, label, current, rotation) {
  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);

  const ux = dx / L;
  const uy = dy / L;

  const px = -uy;
  const py = ux;

  const plateWidth = 16;
  const gap = 4;

  const startX = x1 + ux * 10;
  const startY = y1 + uy * 10;
  const endX = x2 - ux * 10;
  const endY = y2 - uy * 10;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  ctx.beginPath();
  let pStart = rotatePoint(startX, startY, mx, my, rotation);
  ctx.moveTo(pStart.x, pStart.y);

  const plate1X = startX + ux * (L/2 - 10 - gap/2);
  const plate1Y = startY + uy * (L/2 - 10 - gap/2);
  let p1 = rotatePoint(plate1X + px * plateWidth/2, plate1Y + py * plateWidth/2, mx, my, rotation);
  let p2 = rotatePoint(plate1X - px * plateWidth/2, plate1Y - py * plateWidth/2, mx, my, rotation);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);

  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p1.x + ux * gap, p1.y + uy * gap);
  ctx.lineTo(p2.x + ux * gap, p2.y + uy * gap);

  const plate2X = startX + ux * (L/2 - 10 + gap/2);
  const plate2Y = startY + uy * (L/2 - 10 + gap/2);
  let p3 = rotatePoint(plate2X + px * plateWidth/2, plate2Y + py * plateWidth/2, mx, my, rotation);
  let p4 = rotatePoint(plate2X - px * plateWidth/2, plate2Y - py * plateWidth/2, mx, my, rotation);
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);

  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p3.x - ux * gap, p3.y - uy * gap);
  ctx.lineTo(p4.x - ux * gap, p4.y - uy * gap);

  let pEnd = rotatePoint(endX, endY, mx, my, rotation);
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(pEnd.x, pEnd.y);

  ctx.strokeStyle = current != null ? (current > 0 ? "red" : "blue") : "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw thicker plate lines
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.strokeStyle = current != null ? (current > 0 ? "red" : "blue") : "black";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "black";
  ctx.font = "12px Arial";
  ctx.fillText(label, mx + px * 40, my + py * 40);
  if (current != null) {
    ctx.fillText(current.toFixed(3) + " A", mx + px * 40, my + py * 75);
  }

  drawCurrentDot(n1.x, n1.y, n2.x, n2.y, current);
}

function drawInductor(n1, n2, label, current, rotation) {
  const x1 = n1.x, y1 = n1.y;
  const x2 = n2.x, y2 = n2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);

  const ux = dx / L;
  const uy = dy / L;

  const px = -uy;
  const py = ux;

  const coilCount = 5;
  const coilRadius = 5;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const startCoil = L / 3;
  const endCoil = 2 * L / 3;
  const coilSpan = endCoil - startCoil;
  const spacing = coilSpan / coilCount;

  ctx.beginPath();

  // Straight line from node 1 to coil start
  ctx.moveTo(x1, y1);
  let pCoilStart = rotatePoint(x1 + ux * startCoil, y1 + uy * startCoil, mx, my, rotation);
  ctx.lineTo(pCoilStart.x, pCoilStart.y);

  // Draw coils in the center third
  for (let i = 0; i < coilCount; i++) {
    const t = startCoil + spacing * (i + 0.5);
    const cx = x1 + ux * t;
    const cy = y1 + uy * t;

    // Draw semicircle (arc)
    const p1x = cx - px * coilRadius;
    const p1y = cy - py * coilRadius;
    const p2x = cx + px * coilRadius;
    const p2y = cy + py * coilRadius;

    let rp1 = rotatePoint(p1x, p1y, mx, my, rotation);
    let rp2 = rotatePoint(p2x, p2y, mx, my, rotation);

    ctx.lineTo(rp1.x, rp1.y);
    
    // Arc from p1 to p2 via the top (bulging out)
    const rArcCenter = rotatePoint(cx, cy, mx, my, rotation);
    
    const startAngle = Math.atan2((rp1.y - rArcCenter.y), (rp1.x - rArcCenter.x));
    const endAngle = Math.atan2((rp2.y - rArcCenter.y), (rp2.x - rArcCenter.x));
    
    const arcRadius = coilRadius;
    ctx.arc(rArcCenter.x, rArcCenter.y, arcRadius, startAngle, endAngle, false);
  }

  // Straight line from coil end to node 2
  let pCoilEnd = rotatePoint(x1 + ux * endCoil, y1 + uy * endCoil, mx, my, rotation);
  ctx.lineTo(pCoilEnd.x, pCoilEnd.y);
  ctx.lineTo(x2, y2);

  ctx.strokeStyle = current != null ? (current > 0 ? "red" : "blue") : "black";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "black";
  ctx.font = "12px Arial";
  ctx.fillText(label, mx + px * 40, my + py * 40);
  if (current != null) {
    ctx.fillText(current.toFixed(3) + " A", mx + px * 40, my + py * 75);
  }

  drawCurrentDot(n1.x, n1.y, n2.x, n2.y, current);
}
function drawGround(n) {
  const x = n.x;
  const y = n.y;
  
  // Vertical line from node down
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 15);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Three horizontal lines (inverted triangle shape)
  const lineWidth = 12;
  for (let i = 0; i < 3; i++) {
    const w = lineWidth - i * 4;
    const offsetY = 15 + i * 5;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + offsetY);
    ctx.lineTo(x + w / 2, y + offsetY);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
// ---------------------- CURRENT DOT ----------------------

function currentDotSize(I) {
  const minSize = NODE_RADIUS;
  const maxSize = NODE_RADIUS * 3;
  const magnitude = Math.abs(I);

  const size = minSize + Math.log10(1 + magnitude) * (maxSize - minSize);
  return Math.min(maxSize, Math.max(minSize, size));
}

function drawCurrentDot(x1, y1, x2, y2, current) {
  if (current == null) return;

  const t = (animPhase % 1);
  const dir = current >= 0 ? 1 : -1;

  const px = x1 + (x2 - x1) * (dir > 0 ? t : 1 - t);
  const py = y1 + (y2 - y1) * (dir > 0 ? t : 1 - t);

  const radius = currentDotSize(current);

  ctx.beginPath();
  ctx.arc(px, py, radius, 0, 2 * Math.PI);
  ctx.fillStyle = current >= 0 ? "red" : "blue";
  ctx.fill();
}

// ---------------------- SOLVER ----------------------

function solveDC(nodes, components) {
  const N = nodes.length;
  let eqCount = N;

  const voltageSources = components.filter(c => c.type === "voltage");
  eqCount += voltageSources.length;

  const A = Array(eqCount).fill(0).map(() => Array(eqCount).fill(0));
  const b = Array(eqCount).fill(0);

  components.forEach(c => {
    if (c.type === "resistor" || c.type === "wire" || c.type === "inductor") {
      const R = c.value === 0 ? 1e-9 : c.value;
      const g = 1 / R;
      const {n1, n2} = c;

      A[n1][n1] += g;
      A[n2][n2] += g;
      A[n1][n2] -= g;
      A[n2][n1] -= g;
    }
  });

  let row = N;
  voltageSources.forEach(vs => {
    const {n1, n2, value} = vs;

    A[row][n1] = 1;
    A[row][n2] = -1;
    b[row] = value;

    A[n1][row] = 1;
    A[n2][row] = -1;

    row++;
  });

  const currentSources = components.filter(c => c.type === "current");
  currentSources.forEach(cs => {
    const {n1, n2, value} = cs;
    b[n1] -= value;
    b[n2] += value;
  });

  A[0].fill(0);
  A[0][0] = 1;
  b[0] = 0;

  return gaussianSolve(A, b);
}

function gaussianSolve(A, b) {
  const n = A.length;

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i+1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    if (Math.abs(A[i][i]) < 1e-12) continue;

    for (let k = i+1; k < n; k++) {
      const factor = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
      b[k] -= factor * b[i];
    }
  }

  const x = Array(n).fill(0);
  for (let i = n-1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i+1; j < n; j++) sum -= A[i][j] * x[j];
    x[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : sum / A[i][i];
  }
  return x;
}

function computeCurrents(components, V) {
  components.forEach(c => {
    if (c.type === "resistor" || c.type === "inductor") {
      const R = c.value === 0 ? 1e-9 : c.value;
      c.current = (V[c.n1] - V[c.n2]) / R;
    }
    if (c.type === "capacitor") {
      c.current = 0;
    }
    if (c.type === "current") {
      c.voltageDrop = V[c.n1] - V[c.n2];
    }
  });
}

// ---------------------- ANIMATION LOOP ----------------------

function animate() {
  if (animating) {
    animPhase += 0.02;
    draw();
  }
  requestAnimationFrame(animate);
}
animate();

// ---------------------- UTILITY ----------------------

function rotatePoint(px, py, cx, cy, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * Math.cos(a) - dy * Math.sin(a),
    y: cy + dx * Math.sin(a) + dy * Math.cos(a)
  };
}

draw();