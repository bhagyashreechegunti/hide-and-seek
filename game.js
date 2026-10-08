// --- Get the canvas and drawing tools ---
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// --- Room size ---
const ROOM_MARGIN = 40;
const WALL_THICKNESS = 20;

// --- Game state ---
// "menu" | "playing" | "won" | "lost"
let gameState = "menu";
let level = 1;
const MAX_LEVEL = 3;
let doorUnlockIn = 12; // seconds until the exit door opens
let doorOpen = false;
let lastTime = 0;

// Exit door (position set in layoutRoom)
const exitDoor = {
  x: 0,
  y: 0,
  w: 28,
  h: 70,
};

// --- Player ---
const player = {
  x: 200,
  y: 200,
  radius: 18, // used for collisions; drawing is a person shape
  speed: 3.5,
  color: "#2b6cff", // shirt color
  hidden: false,
  moving: false,
  facing: 1, // 1 = looking right, -1 = looking left
};

// --- Seeker with a flashlight (vision cone) ---
const seeker = {
  x: 200,
  y: 200,
  radius: 18,
  speed: 2.0,
  chaseSpeed: 3.0,
  color: "#d62828", // shirt color
  patrolIndex: 0,
  canSeePlayer: false,
  facing: 0, // angle in radians (direction the flashlight points)
  viewAngle: Math.PI / 2.2, // how wide the flashlight cone is
  viewRange: 260, // how far the light reaches
  // If the player makes noise, seeker walks to this point
  investigateX: null,
  investigateY: null,
};

let obstacles = [];

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
};

// --- Touch / on-screen controls ---
// Virtual joystick (left) + restart button (right) for phones
const touchMove = {
  active: false,
  id: null,
  originX: 0,
  originY: 0,
  stickX: 0,
  stickY: 0,
  dx: 0,
  dy: 0,
};

const JOYSTICK_RADIUS = 55;
const STICK_RADIUS = 22;
const TOUCH_DEADZONE = 12;

// Button areas (updated every resize / draw)
let startButton = { x: 0, y: 0, w: 220, h: 56 };
let restartButton = { x: 0, y: 0, w: 70, h: 70 };

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function layoutTouchControls() {
  // Joystick sits bottom-left
  touchMove.originX = 90;
  touchMove.originY = canvas.height - 100;
  if (!touchMove.active) {
    touchMove.stickX = touchMove.originX;
    touchMove.stickY = touchMove.originY;
  }

  // Restart sits bottom-right
  restartButton.w = 72;
  restartButton.h = 72;
  restartButton.x = canvas.width - restartButton.w - 24;
  restartButton.y = canvas.height - restartButton.h - 28;

  // Big center button for menu / end screens
  startButton.w = Math.min(260, canvas.width - 40);
  startButton.h = 58;
  startButton.x = canvas.width / 2 - startButton.w / 2;
  startButton.y = canvas.height / 2 + 70;
}

function pointInRect(px, py, rect) {
  return (
    px >= rect.x &&
    px <= rect.x + rect.w &&
    py >= rect.y &&
    py <= rect.y + rect.h
  );
}

// Convert browser touch/mouse coords → canvas pixel coords
function getCanvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function handlePrimaryAction() {
  if (gameState === "menu") {
    level = 1;
    resetRound();
  } else if (gameState === "won" || gameState === "lost") {
    gameState = "menu";
  }
}

function updateJoystickFromPoint(x, y) {
  let dx = x - touchMove.originX;
  let dy = y - touchMove.originY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = JOYSTICK_RADIUS - 8;

  if (dist > maxDist && dist > 0) {
    dx = (dx / dist) * maxDist;
    dy = (dy / dist) * maxDist;
  }

  touchMove.stickX = touchMove.originX + dx;
  touchMove.stickY = touchMove.originY + dy;
  touchMove.dx = dx;
  touchMove.dy = dy;

  // Map stick to movement flags (same as WASD)
  keys.up = dy < -TOUCH_DEADZONE;
  keys.down = dy > TOUCH_DEADZONE;
  keys.left = dx < -TOUCH_DEADZONE;
  keys.right = dx > TOUCH_DEADZONE;
}

function clearJoystick() {
  touchMove.active = false;
  touchMove.id = null;
  touchMove.dx = 0;
  touchMove.dy = 0;
  touchMove.stickX = touchMove.originX;
  touchMove.stickY = touchMove.originY;
  keys.up = false;
  keys.down = false;
  keys.left = false;
  keys.right = false;
}

function onPointerDown(clientX, clientY, pointerId) {
  const pos = getCanvasPos(clientX, clientY);

  if (gameState === "menu" || gameState === "won" || gameState === "lost") {
    // Tap start button OR anywhere on menu/end to continue
    handlePrimaryAction();
    return;
  }

  if (gameState === "playing") {
    if (pointInRect(pos.x, pos.y, restartButton)) {
      resetRound();
      return;
    }

    // Left half of screen / near joystick = move
    if (pos.x < canvas.width * 0.55 || pointInCircle(pos.x, pos.y, touchMove.originX, touchMove.originY, JOYSTICK_RADIUS + 40)) {
      touchMove.active = true;
      touchMove.id = pointerId;
      updateJoystickFromPoint(pos.x, pos.y);
    }
  }
}

function pointInCircle(px, py, cx, cy, radius) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function onPointerMove(clientX, clientY, pointerId) {
  if (!touchMove.active) return;
  if (touchMove.id !== null && pointerId !== touchMove.id) return;
  const pos = getCanvasPos(clientX, clientY);
  updateJoystickFromPoint(pos.x, pos.y);
}

function onPointerUp(pointerId) {
  if (touchMove.id !== null && pointerId !== touchMove.id) return;
  clearJoystick();
}

// --- Room helpers ---
function getRoomBounds() {
  return {
    left: ROOM_MARGIN + WALL_THICKNESS,
    right: canvas.width - ROOM_MARGIN - WALL_THICKNESS,
    top: ROOM_MARGIN + WALL_THICKNESS,
    bottom: canvas.height - ROOM_MARGIN - WALL_THICKNESS,
  };
}

function applyLevelSettings() {
  // Each level makes the seeker a bit tougher
  if (level === 1) {
    seeker.speed = 2.0;
    seeker.chaseSpeed = 3.0;
    seeker.viewRange = 240;
    doorUnlockIn = 12;
  } else if (level === 2) {
    seeker.speed = 2.4;
    seeker.chaseSpeed = 3.5;
    seeker.viewRange = 280;
    doorUnlockIn = 14;
  } else {
    seeker.speed = 2.8;
    seeker.chaseSpeed = 4.0;
    seeker.viewRange = 320;
    doorUnlockIn = 16;
  }
}

function layoutRoom() {
  const room = getRoomBounds();
  const w = room.right - room.left;
  const h = room.bottom - room.top;

  obstacles = [
    { x: room.left + w * 0.15, y: room.top + h * 0.2, w: 90, h: 50, label: "sofa" },
    { x: room.left + w * 0.55, y: room.top + h * 0.25, w: 70, h: 70, label: "table" },
    { x: room.left + w * 0.2, y: room.top + h * 0.65, w: 80, h: 45, label: "box" },
    { x: room.left + w * 0.65, y: room.top + h * 0.6, w: 55, h: 100, label: "shelf" },
    { x: room.left + w * 0.42, y: room.top + h * 0.45, w: 60, h: 40, label: "crate" },
  ];

  seeker.patrolPoints = [
    { x: room.left + 50, y: room.top + 50 },
    { x: room.right - 50, y: room.top + 50 },
    { x: room.right - 50, y: room.bottom - 50 },
    { x: room.left + 50, y: room.bottom - 50 },
  ];

  // Door on the right wall (center)
  exitDoor.w = 28;
  exitDoor.h = 70;
  exitDoor.x = room.right - exitDoor.w;
  exitDoor.y = room.top + h / 2 - exitDoor.h / 2;
}

function resetRound() {
  const room = getRoomBounds();
  applyLevelSettings();

  player.x = room.left + 60;
  player.y = room.bottom - 60;
  player.hidden = false;
  player.moving = false;

  seeker.x = room.right - 80;
  seeker.y = room.top + 60;
  seeker.patrolIndex = 0;
  seeker.canSeePlayer = false;
  seeker.facing = Math.PI / 2; // start facing down
  seeker.investigateX = null;
  seeker.investigateY = null;

  doorOpen = false;
  doorUnlockIn = level === 1 ? 12 : level === 2 ? 14 : 16;
  gameState = "playing";
  lastTime = 0;
}

function resizeCanvas() {
  const width = window.innerWidth || document.documentElement.clientWidth || 800;
  const height = window.innerHeight || document.documentElement.clientHeight || 600;

  canvas.width = width;
  canvas.height = height;

  layoutRoom();
  layoutTouchControls();
  clearJoystick();

  // Resizing mid-game would scramble positions — return to menu
  if (gameState === "playing") {
    gameState = "menu";
  }
}

function clampCircleToRoom(entity) {
  const room = getRoomBounds();

  if (entity.x - entity.radius < room.left) {
    entity.x = room.left + entity.radius;
  }
  if (entity.x + entity.radius > room.right) {
    entity.x = room.right - entity.radius;
  }
  if (entity.y - entity.radius < room.top) {
    entity.y = room.top + entity.radius;
  }
  if (entity.y + entity.radius > room.bottom) {
    entity.y = room.bottom - entity.radius;
  }
}

function circleHitsRect(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

function resolveObstacles(entity) {
  for (let i = 0; i < obstacles.length; i++) {
    const rect = obstacles[i];
    if (!circleHitsRect(entity.x, entity.y, entity.radius, rect)) {
      continue;
    }

    const overlapLeft = entity.x + entity.radius - rect.x;
    const overlapRight = rect.x + rect.w - (entity.x - entity.radius);
    const overlapTop = entity.y + entity.radius - rect.y;
    const overlapBottom = rect.y + rect.h - (entity.y - entity.radius);
    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    if (minOverlap === overlapLeft) entity.x = rect.x - entity.radius;
    else if (minOverlap === overlapRight) entity.x = rect.x + rect.w + entity.radius;
    else if (minOverlap === overlapTop) entity.y = rect.y - entity.radius;
    else entity.y = rect.y + rect.h + entity.radius;
  }
}

function updateHiddenState() {
  player.hidden = false;
  for (let i = 0; i < obstacles.length; i++) {
    const rect = obstacles[i];
    const cover = {
      x: rect.x - 14,
      y: rect.y - 14,
      w: rect.w + 28,
      h: rect.h + 28,
    };
    if (circleHitsRect(player.x, player.y, player.radius, cover)) {
      player.hidden = true;
      break;
    }
  }
}

// Is a straight line from seeker to player blocked by furniture?
function lineBlockedByFurniture() {
  const steps = 40;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = seeker.x + (player.x - seeker.x) * t;
    const y = seeker.y + (player.y - seeker.y) * t;

    for (let j = 0; j < obstacles.length; j++) {
      const rect = obstacles[j];
      if (
        x >= rect.x &&
        x <= rect.x + rect.w &&
        y >= rect.y &&
        y <= rect.y + rect.h
      ) {
        return true;
      }
    }
  }
  return false;
}

// Flashlight check: in cone + in range + not blocked (+ camouflage rule)
function canSeekerSeePlayer() {
  const dx = player.x - seeker.x;
  const dy = player.y - seeker.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Camouflage: while hidden, only spotted if almost on top of you
  if (player.hidden) {
    return dist < player.radius + seeker.radius + 8;
  }

  if (dist > seeker.viewRange) {
    return false;
  }

  // Angle from seeker facing direction to the player
  const angleToPlayer = Math.atan2(dy, dx);
  let diff = angleToPlayer - seeker.facing;
  // Keep diff between -PI and PI
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  if (Math.abs(diff) > seeker.viewAngle / 2) {
    return false; // outside the flashlight cone
  }

  if (lineBlockedByFurniture()) {
    return false;
  }

  return true;
}

function moveToward(entity, targetX, targetY, speed) {
  const dx = targetX - entity.x;
  const dy = targetY - entity.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) {
    return true;
  }
  const stepX = (dx / dist) * speed;
  const stepY = (dy / dist) * speed;
  entity.x += stepX;
  entity.y += stepY;
  // Point flashlight the way we are walking
  entity.facing = Math.atan2(stepY, stepX);
  return false;
}

function updateSeeker() {
  seeker.canSeePlayer = canSeekerSeePlayer();

  if (seeker.canSeePlayer) {
    moveToward(seeker, player.x, player.y, seeker.chaseSpeed);
    // Remember where we last saw them (for when they duck behind cover)
    seeker.investigateX = player.x;
    seeker.investigateY = player.y;
  } else if (seeker.investigateX !== null) {
    const arrived = moveToward(
      seeker,
      seeker.investigateX,
      seeker.investigateY,
      seeker.speed
    );
    if (arrived) {
      seeker.investigateX = null;
      seeker.investigateY = null;
    }
  } else {
    const point = seeker.patrolPoints[seeker.patrolIndex];
    const arrived = moveToward(seeker, point.x, point.y, seeker.speed);
    if (arrived) {
      seeker.patrolIndex = (seeker.patrolIndex + 1) % seeker.patrolPoints.length;
    }
  }

  clampCircleToRoom(seeker);
  resolveObstacles(seeker);

  const dx = seeker.x - player.x;
  const dy = seeker.y - player.y;
  const touchDist = seeker.radius + player.radius;
  if (dx * dx + dy * dy < touchDist * touchDist) {
    gameState = "lost";
  }
}

function updatePlayer() {
  const oldX = player.x;
  const oldY = player.y;

  if (keys.up) player.y -= player.speed;
  if (keys.down) player.y += player.speed;
  if (keys.left) {
    player.x -= player.speed;
    player.facing = -1;
  }
  if (keys.right) {
    player.x += player.speed;
    player.facing = 1;
  }

  clampCircleToRoom(player);
  resolveObstacles(player);
  updateHiddenState();

  player.moving = player.x !== oldX || player.y !== oldY;

  // Moving in the open makes noise → seeker investigates
  if (player.moving && !player.hidden) {
    seeker.investigateX = player.x;
    seeker.investigateY = player.y;
  }

  // Reach the open exit door to clear the level
  if (doorOpen && circleHitsRect(player.x, player.y, player.radius, exitDoor)) {
    if (level >= MAX_LEVEL) {
      gameState = "won";
    } else {
      level += 1;
      resetRound();
    }
  }
}

// --- Keyboard input (laptop) ---
window.addEventListener("keydown", function (event) {
  const key = event.key.toLowerCase();

  // Don't fight the joystick while a finger is steering
  if (!touchMove.active) {
    if (key === "w" || key === "arrowup") keys.up = true;
    if (key === "s" || key === "arrowdown") keys.down = true;
    if (key === "a" || key === "arrowleft") keys.left = true;
    if (key === "d" || key === "arrowright") keys.right = true;
  }

  if (key === " " || key === "enter") {
    handlePrimaryAction();
    event.preventDefault();
  }

  if (key === "r" && gameState === "playing") {
    resetRound();
  }

  if (
    key === "arrowup" ||
    key === "arrowdown" ||
    key === "arrowleft" ||
    key === "arrowright"
  ) {
    event.preventDefault();
  }
});

window.addEventListener("keyup", function (event) {
  if (touchMove.active) return;
  const key = event.key.toLowerCase();

  if (key === "w" || key === "arrowup") keys.up = false;
  if (key === "s" || key === "arrowdown") keys.down = false;
  if (key === "a" || key === "arrowleft") keys.left = false;
  if (key === "d" || key === "arrowright") keys.right = false;
});

// --- Touch + mouse on the canvas ---
canvas.addEventListener(
  "touchstart",
  function (event) {
    event.preventDefault();
    for (let i = 0; i < event.changedTouches.length; i++) {
      const t = event.changedTouches[i];
      onPointerDown(t.clientX, t.clientY, t.identifier);
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchmove",
  function (event) {
    event.preventDefault();
    for (let i = 0; i < event.changedTouches.length; i++) {
      const t = event.changedTouches[i];
      onPointerMove(t.clientX, t.clientY, t.identifier);
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchend",
  function (event) {
    event.preventDefault();
    for (let i = 0; i < event.changedTouches.length; i++) {
      onPointerUp(event.changedTouches[i].identifier);
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchcancel",
  function (event) {
    for (let i = 0; i < event.changedTouches.length; i++) {
      onPointerUp(event.changedTouches[i].identifier);
    }
  },
  { passive: false }
);

// Mouse also works for testing touch UI on a laptop
canvas.addEventListener("mousedown", function (event) {
  onPointerDown(event.clientX, event.clientY, "mouse");
});

window.addEventListener("mousemove", function (event) {
  if (touchMove.active && touchMove.id === "mouse") {
    onPointerMove(event.clientX, event.clientY, "mouse");
  }
});

window.addEventListener("mouseup", function () {
  if (touchMove.id === "mouse") {
    onPointerUp("mouse");
  }
});

window.addEventListener("resize", resizeCanvas);

// --- Update / Draw ---
function update(deltaSeconds) {
  if (gameState !== "playing") {
    return;
  }

  updatePlayer();
  updateSeeker();

  if (!doorOpen) {
    doorUnlockIn -= deltaSeconds;
    if (doorUnlockIn <= 0) {
      doorUnlockIn = 0;
      doorOpen = true;
    }
  }
}

function drawRoom() {
  ctx.fillStyle = "#222222";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const room = getRoomBounds();
  const outerLeft = ROOM_MARGIN;
  const outerTop = ROOM_MARGIN;
  const outerRight = canvas.width - ROOM_MARGIN;
  const outerBottom = canvas.height - ROOM_MARGIN;

  ctx.fillStyle = "#e8e0d0";
  ctx.fillRect(
    room.left,
    room.top,
    room.right - room.left,
    room.bottom - room.top
  );

  ctx.fillStyle = "#8b5a2b";
  ctx.fillRect(outerLeft, outerTop, outerRight - outerLeft, WALL_THICKNESS);
  ctx.fillRect(
    outerLeft,
    outerBottom - WALL_THICKNESS,
    outerRight - outerLeft,
    WALL_THICKNESS
  );
  ctx.fillRect(outerLeft, outerTop, WALL_THICKNESS, outerBottom - outerTop);
  ctx.fillRect(
    outerRight - WALL_THICKNESS,
    outerTop,
    WALL_THICKNESS,
    outerBottom - outerTop
  );
}

function drawExitDoor() {
  if (doorOpen) {
    ctx.fillStyle = "#2d6a4f";
  } else {
    ctx.fillStyle = "#4a4a4a";
  }
  ctx.fillRect(exitDoor.x, exitDoor.y, exitDoor.w, exitDoor.h);

  ctx.fillStyle = "#ffffff";
  ctx.font = "11px sans-serif";
  ctx.save();
  ctx.translate(exitDoor.x + 8, exitDoor.y + exitDoor.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(doorOpen ? "EXIT" : "LOCKED", 0, 0);
  ctx.restore();
}

function drawObstacles() {
  for (let i = 0; i < obstacles.length; i++) {
    const rect = obstacles[i];
    ctx.fillStyle = "#6b4f3a";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = "#8a6a52";
    ctx.fillRect(rect.x, rect.y, rect.w, 8);
    ctx.fillStyle = "#f0e6d8";
    ctx.font = "12px sans-serif";
    ctx.fillText(rect.label, rect.x + 8, rect.y + 24);
  }
}

// Draw the seeker's flashlight cone
function drawFlashlight() {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(seeker.x, seeker.y);
  ctx.arc(
    seeker.x,
    seeker.y,
    seeker.viewRange,
    seeker.facing - seeker.viewAngle / 2,
    seeker.facing + seeker.viewAngle / 2
  );
  ctx.closePath();
  ctx.fillStyle = seeker.canSeePlayer
    ? "rgba(255, 80, 60, 0.22)"
    : "rgba(255, 230, 150, 0.18)";
  ctx.fill();
  ctx.restore();
}

// Draw a simple person (head, body, arms, legs) instead of a plain dot.
// Collision still uses entity.x / entity.y / entity.radius as a circle.
function drawPerson(entity, shirtColor, options) {
  options = options || {};
  const lookRight = options.lookRight !== false;
  const alpha = options.alpha === undefined ? 1 : options.alpha;
  const isSeeker = options.isSeeker === true;

  const x = entity.x;
  const y = entity.y;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Flip horizontally when looking left
  if (!lookRight) {
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.translate(-x, -y);
  }

  // Legs
  ctx.strokeStyle = "#2b2b2b";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 6);
  ctx.lineTo(x - 7, y + 18);
  ctx.moveTo(x + 5, y + 6);
  ctx.lineTo(x + 7, y + 18);
  ctx.stroke();

  // Body / shirt
  ctx.fillStyle = shirtColor;
  ctx.fillRect(x - 9, y - 8, 18, 16);

  // Arms
  ctx.strokeStyle = shirtColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 4);
  ctx.lineTo(x - 15, y + 4);
  ctx.moveTo(x + 9, y - 4);
  if (isSeeker) {
    // Seeker holds flashlight forward
    ctx.lineTo(x + 18, y - 2);
  } else {
    ctx.lineTo(x + 15, y + 4);
  }
  ctx.stroke();

  if (isSeeker) {
    // Tiny flashlight in hand
    ctx.fillStyle = "#f4d35e";
    ctx.fillRect(x + 16, y - 5, 10, 6);
  }

  // Head
  ctx.beginPath();
  ctx.arc(x, y - 14, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#f1c27d";
  ctx.fill();
  ctx.strokeStyle = "#c9956a";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Eyes (look forward)
  ctx.fillStyle = "#222222";
  ctx.beginPath();
  ctx.arc(x + 2, y - 15, 1.4, 0, Math.PI * 2);
  ctx.arc(x + 5, y - 15, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Hair / hat so roles are clearer
  if (isSeeker) {
    // Cap
    ctx.fillStyle = "#7a1010";
    ctx.beginPath();
    ctx.arc(x, y - 17, 7, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x + 2, y - 18, 10, 3);
  } else {
    ctx.fillStyle = "#3d2b1f";
    ctx.beginPath();
    ctx.arc(x, y - 17, 7, Math.PI, 0);
    ctx.fill();
  }

  ctx.restore();
}

function drawHud() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(ROOM_MARGIN, 4, 380, 70);

  ctx.fillStyle = "#ffffff";
  ctx.font = "14px sans-serif";
  ctx.fillText(
    "Level " + level + "/" + MAX_LEVEL + " · WASD move · hide by furniture",
    ROOM_MARGIN + 10,
    24
  );

  if (doorOpen) {
    ctx.fillStyle = "#95d5b2";
    ctx.fillText("EXIT OPEN — reach the green door!", ROOM_MARGIN + 10, 46);
  } else {
    ctx.fillText(
      "Door unlocks in " + Math.ceil(doorUnlockIn) + "s · moving makes noise",
      ROOM_MARGIN + 10,
      46
    );
  }

  ctx.fillStyle = "#dddddd";
  ctx.fillText("R = restart level", ROOM_MARGIN + 10, 66);

  if (gameState === "playing") {
    ctx.font = "13px sans-serif";
    if (player.hidden) {
      ctx.fillStyle = "#1b7f3a";
      ctx.fillText("Camouflaged", player.x - 34, player.y - 36);
    } else if (seeker.canSeePlayer) {
      ctx.fillStyle = "#c1121f";
      ctx.fillText("Spotted!", player.x - 24, player.y - 36);
    } else if (player.moving) {
      ctx.fillStyle = "#e09f3e";
      ctx.fillText("Noise!", player.x - 18, player.y - 36);
    }
  }
}

function drawMenu() {
  drawRoom();
  drawObstacles();

  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText("Hide & Seek", canvas.width / 2, canvas.height / 2 - 70);

  ctx.font = "18px sans-serif";
  ctx.fillText("Stay out of the red seeker's flashlight", canvas.width / 2, canvas.height / 2 - 20);
  ctx.fillText("Hide by furniture to camouflage", canvas.width / 2, canvas.height / 2 + 8);
  ctx.fillText("When the EXIT opens, escape through it", canvas.width / 2, canvas.height / 2 + 36);

  ctx.fillStyle = "#ffe066";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Press Enter or Space to start", canvas.width / 2, canvas.height / 2 + 90);
  ctx.textAlign = "left";
}

function drawEndScreen() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";

  if (gameState === "won") {
    ctx.fillText("You escaped all levels!", canvas.width / 2, canvas.height / 2 - 10);
  } else {
    ctx.fillText("Caught!", canvas.width / 2, canvas.height / 2 - 10);
  }

  ctx.font = "18px sans-serif";
  ctx.fillText("Press Enter for menu", canvas.width / 2, canvas.height / 2 + 30);
  ctx.textAlign = "left";
}

function draw() {
  if (gameState === "menu") {
    drawMenu();
    return;
  }

  drawRoom();
  drawExitDoor();
  drawObstacles();
  drawFlashlight();

  // Camouflage: fade / brown-out while hidden
  const playerShirt = player.hidden ? "#6b4f3a" : player.color;
  const playerAlpha = player.hidden ? 0.45 : 1;

  drawPerson(player, playerShirt, {
    lookRight: player.facing >= 0,
    alpha: playerAlpha,
    isSeeker: false,
  });

  // Seeker faces the way their flashlight points
  drawPerson(seeker, seeker.color, {
    lookRight: Math.cos(seeker.facing) >= 0,
    alpha: 1,
    isSeeker: true,
  });

  drawHud();

  if (gameState === "won" || gameState === "lost") {
    drawEndScreen();
  }
}

function gameLoop(timestamp) {
  if (!lastTime) {
    lastTime = timestamp;
  }
  const deltaSeconds = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  update(deltaSeconds);
  draw();
  requestAnimationFrame(gameLoop);
}

function startGame() {
  resizeCanvas();
  gameState = "menu";
  requestAnimationFrame(gameLoop);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startGame);
} else {
  startGame();
}
