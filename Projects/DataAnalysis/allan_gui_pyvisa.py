import sys
import time
import math
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from collections import deque
from pathlib import Path
from typing import Optional, List, Iterable, Tuple

import numpy as np
import pandas as pd

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QTabWidget, QVBoxLayout, QHBoxLayout,
    QFormLayout, QLineEdit, QPushButton, QFileDialog, QMessageBox, QLabel,
    QComboBox, QSpinBox, QDoubleSpinBox, QGroupBox
)

from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure


# ============================================================
# Allan deviation math (offline + streaming)
# ============================================================

def overlapping_allan_deviation(y: np.ndarray, dt: float,
                                m_values: Optional[np.ndarray] = None) -> Tuple[np.ndarray, np.ndarray]:
    """
    Overlapping Allan deviation for uniformly sampled y[k].
    """
    y = np.asarray(y, dtype=float).ravel()
    n = len(y)
    if n < 3:
        raise ValueError("Need at least 3 samples to compute Allan deviation.")

    if m_values is None:
        max_m = max(1, n // 2)
        m_values = 2 ** np.arange(0, int(np.floor(np.log2(max_m))) + 1, dtype=int)
    else:
        m_values = np.unique(np.asarray(m_values, dtype=int))
        m_values = m_values[(m_values >= 1) & (m_values <= n // 2)]
        if len(m_values) == 0:
            raise ValueError("No valid m_values (need 1 <= m <= n/2).")

    tau = m_values * dt
    adev = np.full_like(tau, np.nan, dtype=float)

    csum = np.concatenate(([0.0], np.cumsum(y)))
    for i, m in enumerate(m_values):
        ybar = (csum[m:] - csum[:-m]) / m
        if len(ybar) < 2:
            continue
        dy = np.diff(ybar)
        avar = 0.5 * np.mean(dy * dy)
        adev[i] = math.sqrt(avar)

    return tau, adev


@dataclass
class TauState:
    m: int
    window: deque
    running_sum: float = 0.0
    prev_avg: Optional[float] = None
    sumsq_diff: float = 0.0
    count: int = 0

    def update(self, sample: float):
        if len(self.window) == self.window.maxlen:
            oldest = self.window.popleft()
            self.running_sum -= oldest
        self.window.append(sample)
        self.running_sum += sample

        if len(self.window) == self.window.maxlen:
            avg = self.running_sum / self.m
            if self.prev_avg is not None:
                d = avg - self.prev_avg
                self.sumsq_diff += d * d
                self.count += 1
            self.prev_avg = avg

    def adev(self) -> Optional[float]:
        if self.count <= 0:
            return None
        avar = 0.5 * (self.sumsq_diff / self.count)
        return math.sqrt(avar)


class AllanDeviationStreamer:
    def __init__(self, dt: float, m_values: List[int]):
        self.dt = float(dt)
        m_values = sorted(set(int(m) for m in m_values if m >= 1))
        if not m_values:
            raise ValueError("m_values must contain at least one integer >= 1.")
        self.states = [TauState(m=m, window=deque(maxlen=m)) for m in m_values]
        self.m_values = np.array([s.m for s in self.states], dtype=int)

    @property
    def taus(self) -> np.ndarray:
        return self.m_values * self.dt

    def update(self, sample: float):
        for s in self.states:
            s.update(sample)

    def current_adev(self) -> np.ndarray:
        out = np.full(len(self.states), np.nan, dtype=float)
        for i, s in enumerate(self.states):
            a = s.adev()
            if a is not None:
                out[i] = a
        return out


# ============================================================
# Matplotlib canvas widget
# ============================================================

class MplCanvas(FigureCanvas):
    def __init__(self, parent=None):
        fig = Figure(figsize=(6, 4), dpi=100)
        self.ax = fig.add_subplot(111)
        super().__init__(fig)
        self.setParent(parent)

    def plot_adev(self, tau: np.ndarray, adev: np.ndarray, title: str):
        self.ax.clear()
        mask = np.isfinite(adev)
        if np.any(mask):
            self.ax.loglog(tau[mask], adev[mask], marker="o")
        self.ax.grid(True, which="both", ls="--", alpha=0.5)
        self.ax.set_xlabel("Averaging time τ (s)")
        self.ax.set_ylabel("Allan deviation σ(τ)")
        self.ax.set_title(title)
        self.draw_idle()


# ============================================================
# PyVISA acquisition worker (runs in background thread)
# ============================================================

@dataclass
class LiveConfig:
    resource: str
    backend: str  # "" for default
    mode: str     # "buffer" or "poll"
    dt: float

    # Poll settings
    query: str = "READ?"

    # Buffer settings
    block: int = 200
    sample_period: Optional[float] = None

    # DMM settings (generic SCPI-ish; optional)
    meas_range: Optional[float] = None
    nplc: Optional[float] = None
    autozero: Optional[bool] = None

    # Output
    raw_csv: str = ""
    adev_csv: str = ""
    flush_every: int = 200

    # NEW: compute/report ADEV every N samples (default 10)
    calc_every: int = 10


class VisaWorker(QThread):
    status = pyqtSignal(str)
    new_adev = pyqtSignal(object, object, int)      # tau(np), adev(np), samples_seen
    finished_ok = pyqtSignal(str)                   # png_path
    failed = pyqtSignal(str)

    def __init__(self, cfg: LiveConfig, parent=None):
        super().__init__(parent)
        self.cfg = cfg
        self._stop = False

    def request_stop(self):
        self._stop = True

    def _utc(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _visa_open(self):
        import pyvisa
        rm = pyvisa.ResourceManager(self.cfg.backend) if self.cfg.backend else pyvisa.ResourceManager()
        inst = rm.open_resource(self.cfg.resource)
        return rm, inst

    def _configure_instrument(self, inst):
        # IDN (best-effort)
        try:
            idn = inst.query("*IDN?").strip()
            self.status.emit(f"Connected: {idn}")
        except Exception:
            self.status.emit("Connected (IDN query failed).")

        # Generic measurement config:
        # Many DMMs: CONF:VOLT:DC; here we keep it generic but try common DCV first.
        try:
            if self.cfg.meas_range is None:
                inst.write("CONF:VOLT:DC AUTO")
            else:
                inst.write(f"CONF:VOLT:DC {self.cfg.meas_range}")
        except Exception:
            # fallback: select DCV function, range if possible
            try:
                inst.write("SENS:FUNC 'VOLT:DC'")
                if self.cfg.meas_range is not None:
                    inst.write(f"SENS:VOLT:DC:RANG {self.cfg.meas_range}")
            except Exception:
                pass

        # NPLC (integration time)
        if self.cfg.nplc is not None:
            for cmd in (f"VOLT:DC:NPLC {self.cfg.nplc}", f"SENS:VOLT:DC:NPLC {self.cfg.nplc}"):
                try:
                    inst.write(cmd)
                    break
                except Exception:
                    continue

        # Autozero
        if self.cfg.autozero is not None:
            val = "ON" if self.cfg.autozero else "OFF"
            for cmd in (f"VOLT:DC:AZER {val}", f"SENS:VOLT:DC:AZER {val}", f"AZER {val}"):
                try:
                    inst.write(cmd)
                    break
                except Exception:
                    continue

    def _configure_buffer(self, inst):
        # Best-effort SCPI buffered acquisition (varies by vendor/model)
        try:
            inst.write("*CLS")
        except Exception:
            pass

        for cmd in ("TRIG:SOUR IMM", "TRIG:SOURce IMMediate"):
            try:
                inst.write(cmd)
                break
            except Exception:
                continue

        for cmd in (f"SAMP:COUN {self.cfg.block}", f"SAMPLE:COUNT {self.cfg.block}"):
            try:
                inst.write(cmd)
                break
            except Exception:
                continue

        if self.cfg.sample_period is not None:
            for cmd in (f"SAMP:TIM {self.cfg.sample_period}",
                        f"SAMPLE:TIMER {self.cfg.sample_period}",
                        f"TRIG:TIM {self.cfg.sample_period}",
                        f"TRIGGER:TIMER {self.cfg.sample_period}"):
                try:
                    inst.write(cmd)
                    break
                except Exception:
                    continue

    def _read_poll(self, inst) -> Iterable[float]:
        while not self._stop:
            s = inst.query(self.cfg.query).strip()
            yield float(s)
            time.sleep(self.cfg.dt)

    def _read_buffer(self, inst) -> Iterable[float]:
        fetch_cmds = ["FETC?", "FETCH?", "READ?", "TRAC:DATA?"]

        while not self._stop:
            started = False
            for cmd in ("INIT", "INITiate"):
                try:
                    inst.write(cmd)
                    started = True
                    break
                except Exception:
                    continue
            if not started:
                # fallback single read
                try:
                    s = inst.query("READ?").strip()
                    yield float(s)
                    continue
                except Exception:
                    continue

            data = None
            for fcmd in fetch_cmds:
                try:
                    data = inst.query(fcmd).strip()
                    if data:
                        break
                except Exception:
                    continue

            if not data:
                continue

            parts = data.replace("\n", "").split(",")
            for p in parts:
                if self._stop:
                    break
                p = p.strip()
                if not p:
                    continue
                try:
                    yield float(p)
                except ValueError:
                    pass

    def _default_png_path(self) -> str:
        # Prefer directory next to ADEV CSV, else raw CSV, else cwd.
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        base_dir = None
        if self.cfg.adev_csv:
            base_dir = Path(self.cfg.adev_csv).expanduser().resolve().parent
        elif self.cfg.raw_csv:
            base_dir = Path(self.cfg.raw_csv).expanduser().resolve().parent
        else:
            base_dir = Path.cwd()
        return str(base_dir / f"adev_plot_{ts}.png")

    def run(self):
        rm = inst = None
        raw_f = adev_f = None
        raw_w = adev_w = None

        # Tau grid for live plotting/reporting
        m_values = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
        streamer = AllanDeviationStreamer(dt=self.cfg.dt, m_values=m_values)

        start_perf = time.perf_counter()
        png_path = self._default_png_path()

        try:
            self.status.emit("Opening VISA resource...")
            rm, inst = self._visa_open()
            inst.timeout = 10000  # ms

            self._configure_instrument(inst)
            if self.cfg.mode == "buffer":
                self.status.emit("Configuring buffered acquisition...")
                self._configure_buffer(inst)

            # CSV setup
            if self.cfg.raw_csv:
                raw_f = open(self.cfg.raw_csv, "w", newline="")
                raw_w = csv.writer(raw_f)
                raw_w.writerow(["timestamp_utc", "t_rel_s", "sample_index", "value"])

            if self.cfg.adev_csv:
                adev_f = open(self.cfg.adev_csv, "w", newline="")
                adev_w = csv.writer(adev_f)
                adev_w.writerow(["timestamp_utc", "t_rel_s", "samples_seen", "tau_s", "adev"])

            reader = self._read_buffer(inst) if self.cfg.mode == "buffer" else self._read_poll(inst)

            k = 0
            self.status.emit("Streaming started.")
            for val in reader:
                if self._stop:
                    break
                k += 1

                t_rel = time.perf_counter() - start_perf

                # raw row
                if raw_w:
                    raw_w.writerow([self._utc(), f"{t_rel:.6f}", k, float(val)])

                # update streaming estimator per sample
                streamer.update(val)

                # periodic flush
                if (raw_f or adev_f) and (k % max(1, self.cfg.flush_every) == 0):
                    if raw_f: raw_f.flush()
                    if adev_f: adev_f.flush()

                # NEW: compute/report ADEV every N samples (default 10)
                if k % max(1, self.cfg.calc_every) == 0:
                    tau = streamer.taus
                    adev = streamer.current_adev()
                    mask = np.isfinite(adev)

                    if np.any(mask):
                        if adev_w:
                            snap_ts = self._utc()
                            snap_rel = time.perf_counter() - start_perf
                            for t, a in zip(tau[mask], adev[mask]):
                                adev_w.writerow([snap_ts, f"{snap_rel:.6f}", k, float(t), float(a)])

                        # emit to UI
                        self.new_adev.emit(tau, adev, k)

            self.status.emit("Streaming stopped.")
            self.finished_ok.emit(png_path)

        except Exception as e:
            self.failed.emit(str(e))

        finally:
            try:
                if raw_f:
                    raw_f.flush()
                    raw_f.close()
            except Exception:
                pass
            try:
                if adev_f:
                    adev_f.flush()
                    adev_f.close()
            except Exception:
                pass
            try:
                if inst:
                    inst.close()
            except Exception:
                pass
            try:
                if rm:
                    rm.close()
            except Exception:
                pass


# ============================================================
# UI Tabs
# ============================================================

class LiveTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.worker: Optional[VisaWorker] = None
        self._last_tau: Optional[np.ndarray] = None
        self._last_adev: Optional[np.ndarray] = None
        self._samples_seen: int = 0

        layout = QVBoxLayout(self)

        settings_group = QGroupBox("Instrument & Logging")
        form = QFormLayout(settings_group)

        self.resource = QLineEdit()
        self.backend = QLineEdit()
        self.backend.setPlaceholderText("Blank=default; use '@py' for pyvisa-py")

        self.mode = QComboBox()
        self.mode.addItems(["buffer", "poll"])

        self.dt = QDoubleSpinBox()
        self.dt.setDecimals(6)
        self.dt.setRange(1e-6, 1e6)
        self.dt.setValue(0.1)

        self.query = QLineEdit("READ?")

        self.block = QSpinBox()
        self.block.setRange(1, 10_000)
        self.block.setValue(200)

        self.sample_period = QDoubleSpinBox()
        self.sample_period.setDecimals(6)
        self.sample_period.setRange(0.0, 1e6)
        self.sample_period.setValue(0.1)
        self.sample_period.setToolTip("0 = don't send sample timer command")

        # Generic measurement settings (still optional)
        self.meas_range = QDoubleSpinBox()
        self.meas_range.setDecimals(6)
        self.meas_range.setRange(0.0, 1e12)
        self.meas_range.setValue(0.0)
        self.meas_range.setToolTip("0 = AUTO range")

        self.nplc = QDoubleSpinBox()
        self.nplc.setDecimals(3)
        self.nplc.setRange(0.0, 100.0)
        self.nplc.setValue(1.0)
        self.nplc.setToolTip("0 = don't set NPLC")

        self.autozero = QComboBox()
        self.autozero.addItems(["(unchanged)", "on", "off"])

        # File selectors
        self.raw_csv = QLineEdit()
        btn_raw = QPushButton("Browse…")
        btn_raw.clicked.connect(lambda: self._pick_save_file(self.raw_csv, "raw.csv"))

        self.adev_csv = QLineEdit()
        btn_adev = QPushButton("Browse…")
        btn_adev.clicked.connect(lambda: self._pick_save_file(self.adev_csv, "adev.csv"))

        # NEW: calc interval
        self.calc_every = QSpinBox()
        self.calc_every.setRange(1, 1_000_000)
        self.calc_every.setValue(10)

        # Flush control
        self.flush_every = QSpinBox()
        self.flush_every.setRange(1, 1_000_000)
        self.flush_every.setValue(200)


        from PyQt6.QtWidgets import QSizePolicy

        # After creating the widgets:
        for w in (self.calc_every, self.flush_every, self.autozero, self.nplc, self.mode, self.meas_range, self.sample_period, self.block, self.dt):
            w.setMaximumWidth(120)
            w.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)




        # Start/Stop
        self.start_btn = QPushButton("Start")
        self.stop_btn = QPushButton("Stop")
        self.stop_btn.setEnabled(False)

        self.start_btn.clicked.connect(self.start)
        self.stop_btn.clicked.connect(self.stop)

        self.status_lbl = QLabel("Idle.")
        self.status_lbl.setWordWrap(True)

        # Assemble form
        form.addRow("VISA resource:", self.resource)
        form.addRow("VISA backend:", self.backend)
        form.addRow("Mode:", self.mode)
        form.addRow("dt (s):", self.dt)
        form.addRow("Poll query:", self.query)
        form.addRow("Buffer block size:", self.block)
        form.addRow("Instrument sample period (s):", self.sample_period)
        form.addRow("Measurement range:", self.meas_range)
        form.addRow("NPLC:", self.nplc)
        form.addRow("Autozero:", self.autozero)

        raw_row = QHBoxLayout()
        raw_row.addWidget(self.raw_csv)
        raw_row.addWidget(btn_raw)
        form.addRow("Raw CSV:", raw_row)

        adev_row = QHBoxLayout()
        adev_row.addWidget(self.adev_csv)
        adev_row.addWidget(btn_adev)
        form.addRow("ADEV CSV:", adev_row)

        form.addRow("Compute/Update ADEV every N samples:", self.calc_every)
        form.addRow("Flush CSV every N samples:", self.flush_every)

        buttons = QHBoxLayout()
        buttons.addWidget(self.start_btn)
        buttons.addWidget(self.stop_btn)

        # Plot
        self.canvas = MplCanvas(self)
        self.canvas.plot_adev(np.array([1.0]), np.array([np.nan]), "Live Allan Deviation")

        layout.addWidget(settings_group)
        layout.addLayout(buttons)
        layout.addWidget(self.status_lbl)
        layout.addWidget(self.canvas)

        self.mode.currentTextChanged.connect(self._update_ui_for_mode)
        self._update_ui_for_mode(self.mode.currentText())

    def _update_ui_for_mode(self, mode: str):
        is_poll = (mode == "poll")
        self.query.setEnabled(is_poll)
        self.block.setEnabled(not is_poll)
        self.sample_period.setEnabled(not is_poll)

    def _pick_save_file(self, line_edit: QLineEdit, default_name: str):
        path, _ = QFileDialog.getSaveFileName(self, "Choose file", default_name, "CSV files (*.csv);;All files (*.*)")
        if path:
            line_edit.setText(path)

    def _cfg_from_ui(self) -> LiveConfig:
        if not self.resource.text().strip():
            raise ValueError("VISA resource is required.")
        dt = float(self.dt.value())
        if dt <= 0:
            raise ValueError("dt must be > 0.")

        sp = float(self.sample_period.value())
        sample_period = None if sp <= 0 else sp

        mr = float(self.meas_range.value())
        meas_range = None if mr <= 0 else mr

        nplc = float(self.nplc.value())
        nplc_val = None if nplc <= 0 else nplc

        az = self.autozero.currentText()
        autozero = None if az == "(unchanged)" else (az == "on")

        return LiveConfig(
            resource=self.resource.text().strip(),
            backend=self.backend.text().strip(),
            mode=self.mode.currentText(),
            dt=dt,
            query=self.query.text().strip() or "READ?",
            block=int(self.block.value()),
            sample_period=sample_period,
            meas_range=meas_range,
            nplc=nplc_val,
            autozero=autozero,
            raw_csv=self.raw_csv.text().strip(),
            adev_csv=self.adev_csv.text().strip(),
            flush_every=int(self.flush_every.value()),
            calc_every=int(self.calc_every.value()),
        )

    def start(self):
        try:
            cfg = self._cfg_from_ui()
        except Exception as e:
            QMessageBox.critical(self, "Invalid settings", str(e))
            return

        self._last_tau = None
        self._last_adev = None
        self._samples_seen = 0

        self.worker = VisaWorker(cfg)
        self.worker.status.connect(self._on_status)
        self.worker.new_adev.connect(self._on_new_adev)
        self.worker.failed.connect(self._on_failed)
        self.worker.finished_ok.connect(self._on_finished)

        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)
        self._on_status("Starting worker thread...")
        self.worker.start()

    def stop(self):
        if self.worker:
            self._on_status("Stop requested... (saving plot when stopped)")
            self.worker.request_stop()
            self.stop_btn.setEnabled(False)

    def _on_status(self, msg: str):
        self.status_lbl.setText(msg)

    def _on_new_adev(self, tau_obj, adev_obj, samples_seen: int):
        tau = np.array(tau_obj, dtype=float)
        adev = np.array(adev_obj, dtype=float)
        self._last_tau = tau
        self._last_adev = adev
        self._samples_seen = samples_seen
        self.canvas.plot_adev(tau, adev, f"Live Allan Deviation | N={samples_seen}")

    def _save_plot_png(self, png_path: str):
        # Save current canvas figure as PNG
        try:
            # Ensure directory exists
            p = Path(png_path).expanduser().resolve()
            p.parent.mkdir(parents=True, exist_ok=True)
            self.canvas.figure.savefig(str(p), dpi=200)
            return str(p)
        except Exception as e:
            QMessageBox.warning(self, "PNG save failed", str(e))
            return ""

    def _on_failed(self, err: str):
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        QMessageBox.critical(self, "Live acquisition failed", err)
        self._on_status("Failed.")
        self.worker = None

    def _on_finished(self, png_path: str):
        # Save PNG when worker finishes (stop or natural end)
        saved = self._save_plot_png(png_path)
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        if saved:
            self._on_status(f"Idle. Plot saved: {saved}")
        else:
            self._on_status("Idle.")
        self.worker = None


class DataTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)

        group = QGroupBox("Offline Data")
        form = QFormLayout(group)

        self.in_csv = QLineEdit()
        btn_in = QPushButton("Browse…")
        btn_in.clicked.connect(self.pick_in)

        self.column = QLineEdit()
        self.column.setPlaceholderText("Blank = first numeric column")

        self.dt = QDoubleSpinBox()
        self.dt.setDecimals(6)
        self.dt.setRange(1e-6, 1e6)
        self.dt.setValue(0.1)

        self.out_adev = QLineEdit()
        btn_out = QPushButton("Browse…")
        btn_out.clicked.connect(self.pick_out)

        self.compute_btn = QPushButton("Compute & Save ADEV CSV")
        self.compute_btn.clicked.connect(self.compute)

        in_row = QHBoxLayout()
        in_row.addWidget(self.in_csv)
        in_row.addWidget(btn_in)
        form.addRow("Read CSV:", in_row)

        form.addRow("Column:", self.column)
        form.addRow("dt (s):", self.dt)

        out_row = QHBoxLayout()
        out_row.addWidget(self.out_adev)
        out_row.addWidget(btn_out)
        form.addRow("Write ADEV CSV:", out_row)

        form.addRow("", self.compute_btn)

        self.canvas = MplCanvas(self)
        self.canvas.plot_adev(np.array([1.0]), np.array([np.nan]), "Offline Allan Deviation")

        self.status = QLabel("")
        self.status.setWordWrap(True)

        layout.addWidget(group)
        layout.addWidget(self.status)
        layout.addWidget(self.canvas)

    def pick_in(self):
        path, _ = QFileDialog.getOpenFileName(self, "Choose input CSV", "", "CSV files (*.csv);;All files (*.*)")
        if path:
            self.in_csv.setText(path)

    def pick_out(self):
        path, _ = QFileDialog.getSaveFileName(self, "Choose output ADEV CSV", "adev_offline.csv", "CSV files (*.csv);;All files (*.*)")
        if path:
            self.out_adev.setText(path)

    def compute(self):
        in_path = self.in_csv.text().strip()
        out_path = self.out_adev.text().strip()
        if not in_path:
            QMessageBox.warning(self, "Missing input", "Please choose an input CSV.")
            return
        if not out_path:
            QMessageBox.warning(self, "Missing output", "Please choose an output ADEV CSV path.")
            return

        col = self.column.text().strip() or None
        dt = float(self.dt.value())

        try:
            df = pd.read_csv(in_path)
            if col is None:
                num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
                if not num_cols:
                    raise ValueError("No numeric columns found in CSV. Specify a column.")
                col = num_cols[0]

            y = df[col].to_numpy(dtype=float)
            tau, adev = overlapping_allan_deviation(y, dt=dt)

            out_df = pd.DataFrame({"tau_s": tau, "adev": adev})
            out_df.to_csv(out_path, index=False)

            self.canvas.plot_adev(tau, adev, "Offline Allan Deviation")
            self.status.setText(f"Computed ADEV from '{col}'. Saved: {out_path}")

        except Exception as e:
            QMessageBox.critical(self, "Compute failed", str(e))


# ============================================================
# Main Window
# ============================================================

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Allan Deviation Tool (PyVISA + PyQt)")

        tabs = QTabWidget()
        tabs.addTab(DataTab(), "Data")
        tabs.addTab(LiveTab(), "Live")

        self.setCentralWidget(tabs)
        self.resize(1000, 750)


def main():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()