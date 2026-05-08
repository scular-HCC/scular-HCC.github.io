/*************************************************
 * CONSTANTS & GLOBAL STATE
 *************************************************/
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

let classes = [];
let calendar = null;
let groupedClasses = {};






/*************************************************
 * DOM ELEMENTS
 *************************************************/
const fileInput   = document.getElementById("csvInput");
const classList  = document.getElementById("classList");
const resetBtn   = document.getElementById("resetBtn");
const loadnewBtn = document.getElementById("loadnewBtn");
const buildBtn    = document.getElementById("buildBtn");
const pdfBtn      = document.getElementById("pdfBtn");
const conflictDiv = document.getElementById("conflicts");
const desiredClassesTextarea = document.getElementById("desiredClasses");
const optimizeBtn = document.getElementById("optimizeBtn");

// ======================================================
// Program / Semester Buttons (above calendar)
// - Disabled until a file is loaded
// - Electrical Semester 1 auto-fills Desired Classes
// ======================================================
const programButtonsContainer = document.getElementById("programButtons");
const programBtnEls = Array.from(document.querySelectorAll(".program-btn"));

function setProgramButtonsEnabled(enabled) {
  programBtnEls.forEach(btn => {
    btn.disabled = !enabled;
  });
}


// Disable on initial load (until CSV/XLSX is parsed)
setProgramButtonsEnabled(false);

if (programButtonsContainer) {
  programButtonsContainer.addEventListener("click", (e) => {
    const btn = e.target.closest(".program-btn");
    if (!btn || btn.disabled) return;

    const program  = btn.dataset.program;
    const semester = btn.dataset.semester;

    const courses = PROGRAM_TEMPLATES?.[program]?.[semester];

    if (!courses || courses.length === 0) {
      desiredClassesTextarea.value = "";
      alert(`No template defined for ${program} Semester ${semester}.`);
      return;
    }

    // Fill desired classes (one per line)
    desiredClassesTextarea.value = courses.join("\n");

    // Optionally run optimization automatically
    optimizeBtn.click();
  });
}




/*************************************************
 * Class filter input
 *************************************************/
document.getElementById("classFilter").addEventListener("input", (e) => {
  populateClassList(e.target.value);
});


/*************************************************
 * Toggle file type to load
 *************************************************/

let currentMode = "csv";

document.querySelectorAll("input[name='dataMode']").forEach(radio => {
  radio.addEventListener("change", e => {
    currentMode = e.target.value;

    document.getElementById("csvInput").disabled   = currentMode !== "csv";
    document.getElementById("excelInput").disabled = currentMode !== "xlsx";

    resetApp();
  });
});





/*************************************************
 * LOAD CSV VIA FILE PICKER (PapaParse)
 *************************************************/
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {

      // ✅ NORMALIZE CSV ROW SHAPE
      classes = results.data
        .filter(row => row.Section && row.Meetings)
        .map(row => ({
          section: String(row.Section).trim(),   // ✅ REQUIRED
          Meetings: row.Meetings,
          title: row.Title || row.Section         // optional, safe
        }));

      // ✅ GROUP THE SAME WAY AS EXCEL MODE
      groupedClasses = groupClassesBySection(classes);

      // ✅ INITIAL RENDER
      populateClassList("");
      optimizeBtn.disabled = false;
      setProgramButtonsEnabled(true);
    },
    error: (err) => {
      alert("CSV parse error: " + err.message);
    }
  });
});

/*************************************************
 * Track selected classes
 *************************************************/
let selectedSections = new Set();

/*************************************************
 * POPULATE CLASS SELECT LIST
 *************************************************/
function populateClassList(filterText = "") {
  classList.innerHTML = "";

  const normalizedFilter = filterText.toLowerCase();

  Object.keys(groupedClasses)
    .filter(section =>
      section.toLowerCase().includes(normalizedFilter)
    )
    .sort()
    .forEach(section => {
      const label = document.createElement("label");
      label.className = "class-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = section;
      checkbox.checked = selectedSections.has(section);


    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedSections.add(section);
      } else {
        selectedSections.delete(section);
      }

      buildBtn.disabled = selectedSections.size === 0;
    });


      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + section));

      classList.appendChild(label);
    });

  buildBtn.disabled = selectedSections.size === 0;
  resetBtn.disabled = false;
  loadnewBtn.disabled = false;
}


/*************************************************
 * TIME CONVERSION (AM/PM -> 24H)
 *************************************************/
function to24Hour(time, ampm) {
  let [h, m] = time.split(":").map(Number);
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${m
    .toString()
    .padStart(2, "0")}`;
}

/*************************************************
 * PARSE & DEDUPLICATE MEETINGS
 *************************************************/
function parseMeetings(text, section) {
  const meetings = [];
  const seen = new Set();

  const regex =
    /([MTWThF, ]+)\s+(\d{1,2}:\d{2})(?:\s*(AM|PM))?\s*-\s*(\d{1,2}:\d{2})\s*(AM|PM)/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    let [, days, start, sAmpm, end, eAmpm] = match;
    if (!sAmpm) sAmpm = eAmpm;

    const start24 = to24Hour(start, sAmpm);
    const end24   = to24Hour(end, eAmpm);

    
	const dayTokens = days.match(/Th|Tu|Su|Sa|M|W|F/g) || [];

	dayTokens.forEach(d => {
	  const dayNum = DAY_MAP[d];
	  if (dayNum === undefined) return;

	  const key = `${section}|${dayNum}|${start24}|${end24}`;
	  if (seen.has(key)) return;
	  seen.add(key);

	  meetings.push({
		section,
		day: dayNum,
		start: start24,
		end: end24
	  });
	});


      
  }

  return meetings;
}

/*************************************************
 * Change time to minutes for easier conflict detection (e.g. "13:30" -> 810)
  - Returns NaN if invalid format
 *************************************************/

function timeToMinutes(t) {
  if (!t) return NaN;
  const s = String(t).trim();

  // Ensure HH:MM (pads 9:05 -> 09:05)
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return NaN;

  return hh * 60 + mm;
}

/*************************************************
 * CONFLICT DETECTION
 *************************************************/
function detectConflicts(meetings) {
  const conflicts = [];

  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      const a = meetings[i];
      const b = meetings[j];

      // ✅ normalize day to number
      const aDay = Number(a.day);
      const bDay = Number(b.day);
      if (aDay !== bDay) continue;

      // ✅ compare numerically, not lexicographically
      const aStart = timeToMinutes(a.start);
      const aEnd   = timeToMinutes(a.end);
      const bStart = timeToMinutes(b.start);
      const bEnd   = timeToMinutes(b.end);

      // If any time fails parsing, skip safely
      if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) continue;

      // ✅ overlap test
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push([a, b]);
      }
    }
  }

  return conflicts;
}


/*************************************************
 * Reset/Clear BUTTON
 *************************************************/
resetBtn.addEventListener("click", () => {
  clearScheduleUI();
  populateClassList(document.getElementById("classFilter").value || "");
});

/*************************************************
 * Load New File BUTTON
 *************************************************/
loadnewBtn.addEventListener("click", () => {
  resetApp();
  // populateClassList("");
});



/*************************************************
 * BUILD SCHEDULE FUNCTION
 *************************************************/
function buildSchedule(selected) {
  conflictDiv.innerHTML = "";

  if (selected.length === 0) return;

  let meetings = [];

  if (currentMode === "csv") {
    // =====================
    // CSV MODE
    // =====================
    selected.forEach(sec => {
      const row = classes.find(c => c.section === sec);
      if (!row || !row.Meetings) return;

      meetings.push(...parseMeetings(row.Meetings, sec));
    });

  } else {

    
// =====================
// EXCEL MODE (GROUPED)
// =====================
selected.forEach(section => {
  const rows = groupedClasses[section];
  if (!rows) return;

  rows.forEach(row => {
    if (!row.meetingDays || !row.start || !row.end) return;

    expandExcelMeetings(row).forEach(m => meetings.push(m));
  });
});
  }

  const conflicts = detectConflicts(meetings);

  renderCalendar(meetings, conflicts);
  renderConflictSidebar(conflicts);
  pdfBtn.disabled = false;
}

/*************************************************
 * BUILD SCHEDULE BUTTON (CSV + EXCEL SAFE)
 *************************************************/
buildBtn.addEventListener("click", () => {
  buildSchedule(Array.from(selectedSections));
});



/************************************************* 
 * OPTIMIZE SCHEDULE (MINIMAL CONFLICTS) + APPLY TO UI
 *************************************************/
// Programmatically select sections in the UI + state
function applyOptimalSelection(optimalSections) {
  // Update internal selection state
  selectedSections.clear();
  optimalSections.forEach(sec => selectedSections.add(sec));

  // Re-render the class list so checkmarks reflect selectedSections
  // (important if user had a filter applied or list was never refreshed)
  const filterEl = document.getElementById("classFilter");
  const currentFilter = filterEl ? filterEl.value : "";
  populateClassList(currentFilter);

  // Safety: force-check boxes that exist in the DOM right now
  document.querySelectorAll("#classList input[type='checkbox']").forEach(cb => {
    cb.checked = selectedSections.has(cb.value);
  });

  // Enable buttons like a normal manual selection
  buildBtn.disabled = selectedSections.size === 0;
  resetBtn.disabled = false;
  loadnewBtn.disabled = false;
}


/*************************************************
 * OPTIMIZE SCHEDULE BUTTON
 *************************************************/
optimizeBtn.addEventListener("click", () => {
  const desired = desiredClassesTextarea.value.trim();
  if (!desired) {
    alert("Please enter desired classes.");
    return;
  }

  const classNames = desired.split('\n').map(s => s.trim()).filter(s => s);
  if (classNames.length === 0) {
    alert("No valid class names entered.");
    return;
  }

  // Find sections for each class
  const sectionsPerClass = classNames.map(className => {
    const sections = Object.keys(groupedClasses).filter(sec => sec.startsWith(className + '-'));
    return { className, sections };
  });

  // Check if all have sections
  
// Split into available vs missing
const missing = sectionsPerClass
  .filter(c => c.sections.length === 0)
  .map(c => c.className);

const available = sectionsPerClass.filter(c => c.sections.length > 0);

// If NOTHING is available, stop
if (available.length === 0) {
  alert("None of the desired classes have available sections.");
  return;
}

// If SOME are missing, warn but continue
if (missing.length > 0) {
  alert(
    "Some classes have no available sections and will be skipped:\n\n" +
    missing.join("\n")
  );
}

// Find optimal combination using ONLY available classes
const optimalSections = findOptimalSections(available);

if (!optimalSections || optimalSections.length === 0) {
  alert("No schedule combination could be found for the available courses.");
  return;
}

// Select them in the UI + state
applyOptimalSelection(optimalSections);

// Build schedule
buildSchedule(Array.from(selectedSections));

// Add a persistent note AFTER buildSchedule() (because buildSchedule clears conflictDiv)
if (missing.length > 0) {
  conflictDiv.style.color = "#b45309"; // amber-ish
  conflictDiv.innerHTML =
    `<div style="margin-bottom:8px;">
       ⚠ Skipped (no sections found):<br>
       ${missing.map(x => `• ${x}`).join("<br>")}
     </div>` + conflictDiv.innerHTML;
}


  


// Select them in the UI + state
applyOptimalSelection(optimalSections);

// Run the same pipeline as the Build button
buildSchedule(Array.from(selectedSections));

  // Also enable PDF
  pdfBtn.disabled = false;
});

/*************************************************
 * GET MEETINGS FOR SECTIONS
 *************************************************/
function getMeetingsForSections(sections) {
  let meetings = [];

  if (currentMode === "csv") {
    sections.forEach(sec => {
      const row = classes.find(c => c.section === sec);
      if (!row || !row.Meetings) return;
      meetings.push(...parseMeetings(row.Meetings, sec));
    });
  } else {
    sections.forEach(section => {
      const rows = groupedClasses[section];
      if (!rows) return;
      rows.forEach(row => {
        if (!row.meetingDays || !row.start || !row.end) return;
        expandExcelMeetings(row).forEach(m => meetings.push(m));
      });
    });
  }

  return meetings;
}

/*************************************************
 * FIND OPTIMAL SECTIONS (MINIMAL CONFLICTS)
 *************************************************/
function findOptimalSections(sectionsPerClass) {
  let bestCombination = null;
  let minConflicts = Infinity;

  // Recursive function to try combinations
  function tryCombination(index, currentSections) {
    if (index === sectionsPerClass.length) {
      // Check conflicts
      const meetings = getMeetingsForSections(currentSections);
      const conflicts = detectConflicts(meetings);
      if (conflicts.length < minConflicts) {
        minConflicts = conflicts.length;
        bestCombination = currentSections.slice();
      }
      return;
    }

    const { sections } = sectionsPerClass[index];
    for (const sec of sections) {
      currentSections.push(sec);
      tryCombination(index + 1, currentSections);
      currentSections.pop();
    }
  }

  tryCombination(0, []);
  return bestCombination;
}

/*************************************************
 * SECTION COLOR MAP (NO RED TONES)
 *************************************************/
const sectionColors = {};

// Allowed hue ranges (exclude reds ~340–20°)
const SAFE_HUE_RANGES = [
  [30, 140],   // yellow → green
  [160, 260],  // teal → blue
  [280, 330]   // purple → pink (no red)
];

function getSectionColor(section) {
  if (!sectionColors[section]) {
    const range =
      SAFE_HUE_RANGES[Math.floor(Math.random() * SAFE_HUE_RANGES.length)];

    const hue =
      Math.floor(Math.random() * (range[1] - range[0])) + range[0];

    sectionColors[section] = `hsl(${hue}, 65%, 70%)`;
  }

  return sectionColors[section];
}


/*************************************************
 * RENDER FULLCALENDAR + CONFLICT OVERLAYS
 *************************************************/
function renderCalendar(meetings, conflicts) {
  if (calendar) calendar.destroy();

  const classEvents = [];
  const conflictOverlays = [];

  meetings.forEach(m => {
  const color = getSectionColor(m.section);

  classEvents.push({
    title: m.section,
    daysOfWeek: [m.day],
    startTime: m.start,
    endTime: m.end,

    // ✅ Per-class color
    backgroundColor: color,
    borderColor: color,
    textColor: "#000"
  });
});

  conflicts.forEach(([a, b]) => {
  conflictOverlays.push({
    title: "CONFLICT",
    daysOfWeek: [a.day],
    startTime: a.start > b.start ? a.start : b.start,
    endTime: a.end < b.end ? a.end : b.end,

    overlap: true,
    editable: false,
    interactive: false,

    // ✅ treat as normal event
    display: "block",

    // ✅ use CSS for styling
    classNames: ["conflict-overlay"]
  });
});

  calendar = new FullCalendar.Calendar(
    document.getElementById("calendar"),
    {
      initialView: "timeGridWeek",
	  firstDay: 1,
      allDaySlot: false,
	  dayHeaderFormat: { weekday: "short" },
	  initialDate: new Date(2024, 0, 1), // Jan 1, 2024 in LOCAL time (month is 0-based
	  timeZone: "local",
      
	  headerToolbar: {
		left: "",
		center: "",
		right: ""
	  },

      
	  slotMinTime: "08:00:00",
      slotMaxTime: "22:00:00",
      events: [...classEvents, ...conflictOverlays]

    }
  );

//Debug 
//console.table(classEvents.slice(0, 20).map(e => ({
//title: e.title,
//dow: e.daysOfWeek[0],
//start: e.startTime,
//end: e.endTime
//})));

  calendar.render();
}

/*************************************************
 * CONFLICT WARNINGS SIDEBAR
 *************************************************/
function renderConflictSidebar(conflicts) {
  if (!conflicts.length) {
    conflictDiv.style.color = "green";
    conflictDiv.innerHTML = "✅ No conflicts detected.";
    return;
  }

  conflictDiv.style.color = "red";
  conflictDiv.innerHTML = "<strong>⚠ Conflicts:</strong>";

  conflicts.forEach(([a, b]) => {
    conflictDiv.innerHTML += `
      <div style="margin-top:6px;">
        ❌ ${a.section} & ${b.section}<br>
        ${DAY_NAME[a.day]} ${a.start}–${a.end}
      </div>
    `;
  });
}

/*************************************************
 * PDF EXPORT HANDLER (GUARANTEED DOWNLOAD)
 *************************************************/
pdfBtn.addEventListener("click", async () => {
  console.log("Export PDF clicked");

  try {
    const element = document.body;

    const opt = {
      margin:       0.3,
      filename:     "weekly_schedule.pdf",
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: "in", format: "letter", orientation: "landscape" }
    };

    // Create the PDF
    const worker = html2pdf().set(opt).from(element);
    const blob = await worker.outputPdf("blob");

    // Force download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "weekly_schedule.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("PDF download triggered");

  } catch (err) {
    console.error("PDF export failed:", err);
    alert("PDF export failed — check the console.");
  }
});


/*************************************************
 * XLSX read
 *************************************************/
document.getElementById("excelInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // ✅ IMPORTANT FIX IS HERE
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    range: 7
  });

  buildFromExcel(rows);
});

function buildFromExcel(rows) {
  classes = rows
    .filter(r =>
      r["Section"] //&&
      //r["Meeting Days"] &&
      //r["Start Time"] &&
      //r["End Time"]
    )
    .map(r => ({
      // ✅ Section IS the class
      section: String(r["Section"]).trim(),

      // Optional display title
      title: r["Section Title"] || r["Section"],

      // Scheduling data
      meetingDays: r["Meeting Days"],
      start: excelTimeToClock(r["Start Time"]),
      end: excelTimeToClock(r["End Time"]),

      // Optional metadata (safe extras)
      division: r["DIV"],
      capacity: r["Section Capacity"],
      available: r["Available"],
      waitlist: r["H60 Section Waitlisted and Not Enrolled in Course"]
    }));

  console.log("✅ Excel classes loaded:", classes.length);

  groupedClasses = groupClassesBySection(classes);
  populateClassList("");
  console.log("✅ Grouped sections:", Object.keys(groupedClasses).length);
  optimizeBtn.disabled = false;
  setProgramButtonsEnabled(true);

}

// Fix the fractional days used in excel

function excelTimeToClock(value) {
  if (value === null || value === undefined || value === "") return "";

  // If Excel gives a string like "17:30", pass it through safely
  if (typeof value === "string") {
    const s = value.trim();
    // accept "H:MM" or "HH:MM"
    if (/^\d{1,2}:\d{2}$/.test(s)) return s.padStart(5, "0");
    return "";
  }

  if (typeof value !== "number" || Number.isNaN(value)) return "";

  // ✅ Only keep time-of-day fraction (drops whole days)
  const frac = ((value % 1) + 1) % 1; // safe even if weird negatives

  const totalMinutes = Math.round(frac * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}


function resetApp() {
  classes = [];
  selectedSections.clear();

  document.getElementById("classFilter").value = "";

  if (classList) classList.innerHTML = "";
  if (conflictDiv) conflictDiv.innerHTML = "";

  if (calendar) {
    calendar.destroy();
    calendar = null;
  }

  buildBtn.disabled = true;
  resetBtn.disabled = true;
  loadnewBtn.disabled = true;
  pdfBtn.disabled = true;
  optimizeBtn.disabled = true;
}


//Excel meeting Expander
function expandExcelMeetings(row) {
  const str = row.meetingDays || "";

  // ✅ Tokenize days exactly like CSV parsing
  // Handles: M, Tu, W, Th, F, MW, TuTh, MTuWTh, etc.
  const dayTokens = str.match(/Th|Tu|M|W|F/g) || [];

  // ✅ DEBUG (temporary – remove after confirming)
// console.log("Excel days:", str, "→ tokens:", dayTokens);

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

// Group data by section
function groupClassesBySection(rows) {
  const map = {};

  rows.forEach(r => {
    if (!r.section || !String(r.section).trim()) return; // ✅ GUARD

    const key = String(r.section).trim();

    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(r);
  });

  return map;
}


function clearScheduleUI() {
  // Clear only selection + UI
  selectedSections.clear();

  // Uncheck any visible checkboxes
  document.querySelectorAll("#classList input[type='checkbox']").forEach(cb => {
    cb.checked = false;
  });

  // Clear conflicts + calendar
  if (conflictDiv) conflictDiv.innerHTML = "";
  if (calendar) {
    calendar.destroy();
    calendar = null;
  }

  // Disable buttons that depend on having a built schedule/selection
  buildBtn.disabled = true;
  pdfBtn.disabled = true;

  // ✅ Keep Optimize enabled if data exists
  const hasData =
    (classes && classes.length > 0) ||
    (groupedClasses && Object.keys(groupedClasses).length > 0);

  optimizeBtn.disabled = !hasData;
  setProgramButtonsEnabled(hasData);

  // Reset button can stay enabled because data is still loaded
  resetBtn.disabled = false;
}


/*************************************************
 * Templates for program/semester buttons
 *************************************************/
const PROGRAM_TEMPLATES = {
  "Electrical": {
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L","CMSY-141"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "ENES-171"],
    "3": ["ENES-222", "MATH-240", "ENES-246", "PHYS-112", "PHYS-112L"],
    "4": ["ENES-247", "ENES-205", "MATH-260"]
  },
  
  "Mechanical": { 
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "ENES-120"], 
    "3": ["CHEM-135", "MATH-240", "ENES-181", "CHEM-136", "ENES-271"], 
    "4": ["ENES-130", "ENES-140", "ENES-200", "PHYS-112", "PHYS-112L"]
  },

  "Fire Protection": { 
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "ENES-120"], 
    "3": ["CHEM-135", "MATH-240", "ENES-181", "CHEM-136", "ENES-271"], 
    "4": ["ENES-130", "ENES-140", "ENES-200", "ENES-250", "MATH-250"]
  },
  
  "Computer Eng": {
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "CMSY-141"],
    "3": ["CHEM-135", "CHEM-136", "ENES-246", "MATH-260", "ENES-171"],
    "4": ["ENES-247", "ENES-205", "MATH-260"]
  },
  
  "Civil": { 
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "ENES-120"], 
    "3": ["CHEM-135", "MATH-240", "ENES-271", "CHEM-136", "GEOL-107"], 
    "4": ["ENES-130", "ENES-140", "PHYS-112", "PHYS-112L", "MATH-260"]
  },
  
  "Aerospace": { 
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "ENES-120"], 
    "3": ["CHEM-135", "MATH-260", "ENES-181", "CHEM-136"], 
    "4": ["ENES-130", "ENES-140", "ENES-283", "MATH-250"]
  },
  
    "Chem/Bio Eng": {  
    "1": ["ENES-100", "MATH-181", "ENGL-121", "PHYS-110", "PHYS-110L", "CHEM-101", "CHEM-101L"],
    "2": ["MATH-182", "PHYS-111", "PHYS-111L", "BIOL-120", "BIOL-121"], 
    "3": ["ENES-271", "MATH-240", "CHEM-201", "CHEM-201L"], 
    "4": ["CHEM-202", "CHEM-202L", "MATH-260", "PHYS-112", "PHYS-112L"],
}
};

programButtonsContainer.addEventListener("click", (e) => {
  const btn = e.target.closest(".program-btn");
  if (!btn || btn.disabled) return;

  const program = btn.dataset.program;
  const semester = btn.dataset.semester;

  const courses = PROGRAM_TEMPLATES?.[program]?.[semester] || [];
  desiredClassesTextarea.value = courses.join("\n");
});
