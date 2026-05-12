/*************************************************
 * HCC Weekly Schedule Planner (clean build)
 * - Tabs above calendar
 * - One calendar instance
 * - Templates loaded from templates.json
 *************************************************/

/********************
 * CONSTANTS/STATE
 ********************/
const DAY_MAP = { M: 1, Tu: 2, W: 3, Th: 4, F: 5, Sa: 6, Su: 0 };
const DAY_NAME = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday"
};

let currentMode = "csv";
let classes = [];
let groupedClasses = {};
let calendar = null;
let selectedSections = new Set();

let PROGRAM_TEMPLATES = {};
let templatesLoaded = false;

/********************
 * DOM ELEMENTS
 ********************/
const csvInput = document.getElementById("csvInput");
const excelInput = document.getElementById("excelInput");
const classList = document.getElementById("classList");
const resetBtn = document.getElementById("resetBtn");
const loadnewBtn = document.getElementById("loadnewBtn");
const buildBtn = document.getElementById("buildBtn");
const pdfBtn = document.getElementById("pdfBtn");
const conflictDiv = document.getElementById("conflicts");
const desiredClassesTextarea = document.getElementById("desiredClasses");
const optimizeBtn = document.getElementById("optimizeBtn");
const filterInput = document.getElementById("classFilter");

/********************
 * TABS
 ********************/
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  const tabId = btn.dataset.tab;
  if (!tabId) return;

  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add("active");

  if (calendar && typeof calendar.updateSize === "function") {
    calendar.updateSize();
  }
});

/********************
 * MODE TOGGLE
 ********************/
function updateModeUI() {
  csvInput.disabled = currentMode !== "csv";
  excelInput.disabled = currentMode !== "xlsx";
}

document.querySelectorAll("input[name='dataMode']").forEach(radio => {
  radio.addEventListener("change", (e) => {
    currentMode = e.target.value;
    updateModeUI();
    hardReset();
  });
});
updateModeUI();

/********************
 * TEMPLATES LOADING
 ********************/
async function loadProgramTemplates() {
  const res = await fetch("templates.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load templates.json (${res.status})`);
  PROGRAM_TEMPLATES = await res.json();
  templatesLoaded = true;
}

// Start loading templates (do not block UI)
loadProgramTemplates().catch(err => {
  console.error(err);
  templatesLoaded = false;
});

/********************
 * TEMPLATE BUTTONS (Programs + Faculty)
 * - Enabled after schedule data is loaded
 ********************/
const templateBtnEls = Array.from(document.querySelectorAll(".template-btn"));

function setTemplateButtonsEnabled(enabled) {
  templateBtnEls.forEach(b => (b.disabled = !enabled));
}
setTemplateButtonsEnabled(false);

function getTemplateCourses(kind, key1, key2) {
  if (!templatesLoaded) return [];

  if (kind === "program") {
    // PROGRAM_TEMPLATES[Program][Semester]
    return (PROGRAM_TEMPLATES?.[key1]?.[key2]) || [];
  }

  if (kind === "faculty") {
    // Preferred: PROGRAM_TEMPLATES.Faculty[Topic][Fall|Spring]
    return (PROGRAM_TEMPLATES?.Faculty?.[key1]?.[key2]) || [];
  }

  return [];
}

// Delegated click handler
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".template-btn");
  if (!btn || btn.disabled) return;

  const kind = btn.dataset.templateKind;
  let k1 = "";
  let k2 = "";

  if (kind === "faculty") {
    k1 = btn.dataset.topic;
    k2 = btn.dataset.term;
  } else {
    k1 = btn.dataset.program;
    k2 = btn.dataset.semester;
  }

  const courses = getTemplateCourses(kind, k1, k2);

  if (!courses.length) {
    desiredClassesTextarea.value = "";
    alert(`No template defined for ${k1} ${k2}.`);
    return;
  }

  desiredClassesTextarea.value = courses.join("\n");

  // Active styling per kind
  templateBtnEls
    .filter(b => b.dataset.templateKind === kind)
    .forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  if (!optimizeBtn.disabled) optimizeBtn.click();
});

/********************
 * CLASS FILTER
 ********************/
filterInput.addEventListener("input", (e) => {
  populateClassList(e.target.value);
});

/********************
 * POPULATE CLASS LIST
 ********************/
function populateClassList(filterText = "") {
  classList.innerHTML = "";
  const normalized = filterText.toLowerCase();

  const sections = Object.keys(groupedClasses)
    .filter(sec => sec.toLowerCase().includes(normalized))
    .sort();

  sections.forEach(section => {
    const label = document.createElement("label");
    label.className = "class-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = section;
    cb.checked = selectedSections.has(section);

    cb.addEventListener("change", () => {
      if (cb.checked) selectedSections.add(section);
      else selectedSections.delete(section);
      buildBtn.disabled = selectedSections.size === 0;
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + section));
    classList.appendChild(label);
  });

  buildBtn.disabled = selectedSections.size === 0;
  resetBtn.disabled = false;
  loadnewBtn.disabled = false;
}

/********************
 * GROUP BY SECTION
 ********************/
function groupClassesBySection(rows) {
  const map = {};
  rows.forEach(r => {
    const key = String(r.section || "").trim();
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  });
  return map;
}

/********************
 * CSV LOAD
 ********************/
csvInput.addEventListener("change", () => {
  const file = csvInput.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      classes = (results.data || [])
        .map(r => ({
          section: String(r.Section || r.section || "").trim(),
          Meetings: r.Meetings || r.meetings || ""
        }))
        .filter(r => r.section);

      groupedClasses = groupClassesBySection(classes);
      populateClassList("");

      optimizeBtn.disabled = false;
      setTemplateButtonsEnabled(true);
    }
  });
});

/********************
 * XLSX LOAD
 ********************/
excelInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", range: 7 });

  classes = rows
    .filter(r => r["Section"]) 
    .map(r => ({
      section: String(r["Section"]).trim(),
      meetingDays: String(r["Meeting Days"] || r["Meeting Day"] || r["Days"] || "").trim(),
      start: excelTimeToClock(r["Start Time"] || r["Start"] || ""),
      end: excelTimeToClock(r["End Time"] || r["End"] || "")
    }));

  groupedClasses = groupClassesBySection(classes);
  populateClassList("");

  optimizeBtn.disabled = false;
  setTemplateButtonsEnabled(true);
});

/********************
 * TIME HELPERS
 ********************/
function to24Hour(time, ampm) {
  let [h, m] = time.split(":").map(Number);
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function excelTimeToClock(value) {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d{1,2}:\d{2}$/.test(s)) return s.padStart(5, "0");
    return "";
  }

  if (typeof value !== "number" || Number.isNaN(value)) return "";

  const frac = ((value % 1) + 1) % 1;
  const totalMinutes = Math.round(frac * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function timeToMinutes(t) {
  if (!t) return NaN;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/********************
 * MEETING PARSING
 ********************/
function parseMeetings(text, section) {
  const meetings = [];
  const seen = new Set();

  const regex = /([MTWThFSu, ]+)\s+(\d{1,2}:\d{2})(?:\s*(AM|PM))?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    let [, days, start, sAmpm, end, eAmpm] = match;
    if (!sAmpm) sAmpm = eAmpm;

    const start24 = to24Hour(start, sAmpm);
    const end24 = to24Hour(end, eAmpm);

    const dayTokens = (days.match(/Th|Tu|Su|Sa|M|W|F/g) || []);
    dayTokens.forEach(d => {
      const dayNum = DAY_MAP[d];
      if (dayNum === undefined) return;
      const key = `${section}|${dayNum}|${start24}|${end24}`;
      if (seen.has(key)) return;
      seen.add(key);
      meetings.push({ section, title: section, day: dayNum, start: start24, end: end24 });
    });
  }

  return meetings;
}

function expandExcelMeetings(row) {
  const str = row.meetingDays || "";
  const dayTokens = str.match(/Th|Tu|Su|Sa|M|W|F/g) || [];
  return dayTokens
    .map(d => DAY_MAP[d])
    .filter(dayNum => dayNum !== undefined)
    .map(dayNum => ({
      section: row.section,
      title: row.section,
      day: dayNum,
      start: row.start,
      end: row.end
    }));
}

/********************
 * CONFLICT DETECTION
 ********************/
function detectConflicts(meetings) {
  const conflicts = [];
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      const a = meetings[i];
      const b = meetings[j];
      if (Number(a.day) !== Number(b.day)) continue;

      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      const bStart = timeToMinutes(b.start);
      const bEnd = timeToMinutes(b.end);
      if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) continue;

      if (aStart < bEnd && bStart < aEnd) conflicts.push([a, b]);
    }
  }
  return conflicts;
}

/********************
 * BUILD SCHEDULE
 ********************/
function getMeetingsForSections(sections) {
  let meetings = [];
  if (currentMode === "csv") {
    sections.forEach(sec => {
      const row = classes.find(c => c.section === sec);
      if (!row || !row.Meetings) return;
      meetings.push(...parseMeetings(row.Meetings, sec));
    });
  } else {
    sections.forEach(sec => {
      const rows = groupedClasses[sec];
      if (!rows) return;
      rows.forEach(r => {
        if (!r.meetingDays || !r.start || !r.end) return;
        meetings.push(...expandExcelMeetings(r));
      });
    });
  }
  return meetings;
}

function buildSchedule(selected) {
  conflictDiv.innerHTML = "";
  if (!selected.length) return;

  const meetings = getMeetingsForSections(selected);
  const conflicts = detectConflicts(meetings);

  renderCalendar(meetings, conflicts);
  renderConflictSidebar(conflicts);

  pdfBtn.disabled = false;
}

buildBtn.addEventListener("click", () => {
  buildSchedule(Array.from(selectedSections));
});

/********************
 * OPTIMIZE SCHEDULE
 ********************/
function applyOptimalSelection(optimalSections) {
  selectedSections.clear();
  optimalSections.forEach(sec => selectedSections.add(sec));
  populateClassList(filterInput.value || "");
  buildBtn.disabled = selectedSections.size === 0;
  resetBtn.disabled = false;
  loadnewBtn.disabled = false;
}

function findOptimalSections(sectionsPerClass) {
  let bestCombination = null;
  let minConflicts = Infinity;

  function tryCombination(index, currentSections) {
    if (index === sectionsPerClass.length) {
      const meetings = getMeetingsForSections(currentSections);
      const conflicts = detectConflicts(meetings);
      if (conflicts.length < minConflicts) {
        minConflicts = conflicts.length;
        bestCombination = [...currentSections];
      }
      return;
    }

    const options = sectionsPerClass[index].sections;
    for (const sec of options) {
      currentSections.push(sec);
      tryCombination(index + 1, currentSections);
      currentSections.pop();
    }
  }

  tryCombination(0, []);
  return bestCombination;
}

optimizeBtn.addEventListener("click", () => {
  const desired = desiredClassesTextarea.value.trim();
  if (!desired) {
    alert("Please enter desired classes.");
    return;
  }

  const classNames = desired.split("\n").map(s => s.trim()).filter(Boolean);
  if (!classNames.length) {
    alert("No valid class names entered.");
    return;
  }

  const sectionsPerClass = classNames.map(className => {
    const sections = Object.keys(groupedClasses).filter(sec => sec.startsWith(className + "-"));
    return { className, sections };
  });

  const missing = sectionsPerClass.filter(c => c.sections.length === 0).map(c => c.className);
  const available = sectionsPerClass.filter(c => c.sections.length > 0);

  if (!available.length) {
    alert("None of the desired classes have available sections.");
    return;
  }

  if (missing.length) {
    alert("Some classes have no available sections and will be skipped:\n\n" + missing.join("\n"));
  }

  const optimalSections = findOptimalSections(available);
  if (!optimalSections || !optimalSections.length) {
    alert("No schedule combination could be found for the available courses.");
    return;
  }

  applyOptimalSelection(optimalSections);
  buildSchedule(Array.from(selectedSections));
});

/********************
 * CALENDAR RENDERING
 ********************/
const sectionColors = {};
const SAFE_HUE_RANGES = [[30,140],[160,260],[280,330]];

function getSectionColor(section) {
  if (!sectionColors[section]) {
    const range = SAFE_HUE_RANGES[Math.floor(Math.random() * SAFE_HUE_RANGES.length)];
    const hue = range[0] + Math.floor(Math.random() * (range[1] - range[0]));
    sectionColors[section] = `hsl(${hue}, 70%, 80%)`;
  }
  return sectionColors[section];
}

function renderCalendar(meetings, conflicts) {
  if (calendar) calendar.destroy();

  const classEvents = meetings.map(m => ({
    title: m.section,
    daysOfWeek: [m.day],
    startTime: m.start,
    endTime: m.end,
    backgroundColor: getSectionColor(m.section),
    borderColor: getSectionColor(m.section)
  }));

  const conflictOverlays = conflicts.map(([a, b]) => ({
    title: "CONFLICT",
    daysOfWeek: [a.day],
    startTime: a.start > b.start ? a.start : b.start,
    endTime: a.end < b.end ? a.end : b.end,
    classNames: ["conflict-overlay"],
    backgroundColor: "transparent",
    borderColor: "transparent",
    textColor: "transparent",
    display: "block"
  }));

  calendar = new FullCalendar.Calendar(document.getElementById("calendar"), {
    initialView: "timeGridWeek",
    firstDay: 1,
    allDaySlot: false,
    dayHeaderFormat: { weekday: "short" },
    initialDate: new Date(2024, 0, 1),
    timeZone: "local",
    events: [...classEvents, ...conflictOverlays]
  });

  calendar.render();
  window.calendar = calendar;
  setTimeout(() => calendar.updateSize(), 0);
}

function renderConflictSidebar(conflicts) {
  if (!conflicts.length) {
    conflictDiv.style.color = "green";
    conflictDiv.textContent = "No conflicts detected.";
    return;
  }

  conflictDiv.style.color = "red";
  conflictDiv.innerHTML = "<b>Conflicts:</b>";
  conflicts.forEach(([a, b]) => {
    conflictDiv.innerHTML += `<div style="margin-top:6px;">${a.section} &amp; ${b.section}<br>${DAY_NAME[a.day]} ${a.start}-${a.end}</div>`;
  });
}

/********************
 * RESET / LOAD NEW
 ********************/
function clearScheduleUI() {
  selectedSections.clear();
  populateClassList(filterInput.value || "");

  conflictDiv.innerHTML = "";

  if (calendar) {
    calendar.destroy();
    calendar = null;
    window.calendar = null;
  }

  buildBtn.disabled = true;
  pdfBtn.disabled = true;

  const hasData = (classes && classes.length > 0) || (groupedClasses && Object.keys(groupedClasses).length > 0);
  optimizeBtn.disabled = !hasData;
  setTemplateButtonsEnabled(hasData);

  resetBtn.disabled = false;
}

function hardReset() {
  classes = [];
  groupedClasses = {};
  selectedSections.clear();

  filterInput.value = "";
  classList.innerHTML = "";
  conflictDiv.innerHTML = "";
  desiredClassesTextarea.value = "";

  if (calendar) {
    calendar.destroy();
    calendar = null;
    window.calendar = null;
  }

  buildBtn.disabled = true;
  resetBtn.disabled = true;
  loadnewBtn.disabled = true;
  pdfBtn.disabled = true;
  optimizeBtn.disabled = true;
  setTemplateButtonsEnabled(false);

  csvInput.value = "";
  excelInput.value = "";
}

resetBtn.addEventListener("click", () => {
  clearScheduleUI();
});

loadnewBtn.addEventListener("click", () => {
  hardReset();
  if (currentMode === "csv") csvInput.click();
  else excelInput.click();
});

/********************
 * PDF EXPORT
 ********************/
pdfBtn.addEventListener("click", async () => {
  try {
    const element = document.body;
    const opt = {
      margin: 0.3,
      filename: "schedule.pdf",
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "in", format: "letter", orientation: "portrait" }
    };
    await html2pdf().set(opt).from(element).save();
  } catch (err) {
    console.error(err);
    alert("PDF export failed. Check console.");
  }
});
