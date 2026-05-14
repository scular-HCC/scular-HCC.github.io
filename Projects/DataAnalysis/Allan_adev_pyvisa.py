import time
import math
import argparse
from dataclasses import dataclass
from collections import deque
from typing import Iterable, Optional, List, Tuple

import numpy as np
import matplotlib.pyplot as plt

# ----------------------------
# OFFLINE: Overlapping Allan deviation
# ----------------------------
def overlapping_allan_deviation(y: np.ndarray, dt: float,
                                m_values: Optional[np.ndarray] = None) -> Tuple[np.ndarray, np.ndarray]:
    """
    Overlapping Allan deviation for uniformly sampled y[k].

    y: 1D array
    dt: sample period (seconds)
    m_values: averaging factors in samples, tau = m*dt
    """
    y = np.asarray(y, dtype=float).ravel()
    n = len(y)
    if n < 3:
        raise ValueError("Need at least 3 samples.")

    if m_values is None:
        max_m = max(1, n // 2)
        m_values = 2 ** np.arange(0, int(np.floor(np.log2(max_m))) + 1, dtype=int)
    else:
        m_values = np.unique(np.asarray(m_values, dtype=int))
        m_values = m_values[(m_values >= 1) & (m_values <= n // 2)]
        if len(m_values) == 0:
            raise ValueError("No valid m_values remain after filtering.")

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


# ----------------------------
# STREAMING: incremental overlapping Allan deviation estimator
# ----------------------------
@dataclass
class TauState:
    m: int
    window: deque
    running_sum: float = 0.0
    prev_avg: Optional[float] = None
    sumsq_diff: float = 0.0
    count: int = 0

    def update(self, sample: float):
        # maintain rolling sum of last m samples
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


# ----------------------------
# CSV loader (offline)
# ----------------------------
def load_csv_column(path: str, column: Optional[str] = None) -> np.ndarray:
    import pandas as pd
    df = pd.read_csv(path)
    if column is not None:
        return df[column].to_numpy(dtype=float)

    # pick first numeric column
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not num_cols:
        raise ValueError("No numeric columns found; specify column name.")
    return df[num_cols[0]].to_numpy(dtype=float)


# ----------------------------
# PyVISA instrument readers
# ----------------------------
def visa_open(resource: str, backend: Optional[str] = None):
    import pyvisa
    rm = pyvisa.ResourceManager(backend) if backend else pyvisa.ResourceManager()
    inst = rm.open_resource(resource)
    return rm, inst

def configure_dmm_dc_voltage(inst,
                             volt_range: Optional[float] = None,
                             nplc: Optional[float] = None,
                             autozero: Optional[bool] = None):
    """
    Generic SCPI-ish configuration for many DMMs.
    Not all instruments support all commands — adjust per manual.
    """
    # Identify
    try:
        idn = inst.query("*IDN?").strip()
        print(f"Connected: {idn}")
    except Exception:
        print("Connected (IDN query failed).")

    # Configure DC voltage
    if volt_range is None:
        inst.write("CONF:VOLT:DC AUTO")
    else:
        inst.write(f"CONF:VOLT:DC {volt_range}")

    # NPLC (integration time): higher reduces noise, lowers sample rate
    if nplc is not None:
        try:
            inst.write(f"VOLT:DC:NPLC {nplc}")
        except Exception:
            # some DMMs use different tree
            inst.write(f"SENS:VOLT:DC:NPLC {nplc}")

    # Autozero (if available)
    if autozero is not None:
        val = "ON" if autozero else "OFF"
        for cmd in ("VOLT:DC:AZER", "SENS:VOLT:DC:AZER", "AZER"):
            try:
                inst.write(f"{cmd} {val}")
                break
            except Exception:
                continue


def reader_polling_read(inst, dt: float, query: str = "READ?") -> Iterable[float]:
    """
    Simple polling mode. Timing is dominated by VISA/transport jitter.
    We still sleep(dt) to roughly enforce spacing.
    """
    while True:
        s = inst.query(query).strip()
        yield float(s)
        time.sleep(dt)


def configure_buffered_acquisition(inst,
                                  sample_count: int,
                                  sample_period: Optional[float] = None):
    """
    Configure the DMM to take a block of samples internally, then return them.

    Commands vary across instruments. This function tries common SCPI patterns.
    You may need to edit based on your specific model.

    sample_period: if supported (seconds), sets internal sample timer.
    """
    # Clear status/buffers
    for cmd in ("*CLS",):
        try:
            inst.write(cmd)
        except Exception:
            pass

    # Use immediate trigger source if supported
    for cmd in ("TRIG:SOUR IMM", "TRIG:SOURce IMMediate"):
        try:
            inst.write(cmd)
            break
        except Exception:
            continue

    # Set sample count
    for cmd in (f"SAMP:COUN {sample_count}", f"SAMPLE:COUNT {sample_count}"):
        try:
            inst.write(cmd)
            break
        except Exception:
            continue

    # Try to set a sample timer (not all DMMs support SAMP:TIM)
    if sample_period is not None:
        for cmd in (f"SAMP:TIM {sample_period}", f"SAMPLE:TIMER {sample_period}",
                    f"TRIG:TIM {sample_period}", f"TRIGGER:TIMER {sample_period}"):
            try:
                inst.write(cmd)
                break
            except Exception:
                continue


def reader_buffered_fetch(inst,
                          sample_count: int,
                          fetch_cmds: List[str] = None) -> Iterable[float]:
    """
    Repeatedly arms acquisition and fetches a block of comma-separated readings.
    """
    if fetch_cmds is None:
        # Common fetch commands across many DMMs
        fetch_cmds = ["FETC?", "FETCH?", "READ?", "TRAC:DATA?"]

    while True:
        # Start acquisition
        for cmd in ("INIT", "INITiate"):
            try:
                inst.write(cmd)
                break
            except Exception:
                continue

        # Fetch the samples
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

        # Parse block: often "v1,v2,v3,..."
        parts = data.replace("\n", "").split(",")
        for p in parts:
            p = p.strip()
            if p:
                try:
                    yield float(p)
                except ValueError:
                    pass


# ----------------------------
# Live plotting
# ----------------------------
def live_plot(sample_source: Iterable[float],
              dt: float,
              m_values: List[int],
              update_every: int = 50,
              title: str = "Live Allan Deviation (Voltage)"):
    streamer = AllanDeviationStreamer(dt=dt, m_values=m_values)

    plt.ion()
    fig, ax = plt.subplots()
    line, = ax.loglog([], [], marker="o")
    ax.grid(True, which="both", ls="--", alpha=0.5)
    ax.set_xlabel("Averaging time τ (s)")
    ax.set_ylabel("Allan deviation σ(τ) [V]")
    ax.set_title(title)

    k = 0
    for sample in sample_source:
        streamer.update(sample)
        k += 1

        if k % update_every == 0:
            tau = streamer.taus
            adev = streamer.current_adev()
            mask = np.isfinite(adev)
            if np.any(mask):
                line.set_data(tau[mask], adev[mask])
                ax.relim()
                ax.autoscale_view()
                fig.canvas.draw()
                fig.canvas.flush_events()


# ----------------------------
# Main entry points
# ----------------------------
def main():
    ap = argparse.ArgumentParser(description="Offline + Live Allan deviation for voltage readings via PyVISA.")
    sub = ap.add_subparsers(dest="mode", required=True)

    # Offline mode
    ap_off = sub.add_parser("offline", help="Compute Allan deviation from CSV")
    ap_off.add_argument("--csv", required=True, help="Path to CSV file")
    ap_off.add_argument("--column", default=None, help="Column name (default: first numeric)")
    ap_off.add_argument("--dt", type=float, required=True, help="Sample period (seconds)")

    # Live mode
    ap_live = sub.add_parser("live", help="Stream from PyVISA instrument and plot Allan deviation")
    ap_live.add_argument("--resource", required=True, help='VISA resource string e.g. "USB0::0xXXXX::0xYYYY::INSTR"')
    ap_live.add_argument("--backend", default=None, help='Optional VISA backend, e.g. "@py" for pyvisa-py')
    ap_live.add_argument("--dt", type=float, required=True, help="Sample period used for Allan deviation τ=m·dt (seconds)")
    ap_live.add_argument("--style", choices=["poll", "buffer"], default="buffer", help="Acquisition style")
    ap_live.add_argument("--query", default="READ?", help='Query for poll mode, default "READ?"')
    ap_live.add_argument("--block", type=int, default=100, help="Samples per block in buffer mode")
    ap_live.add_argument("--sample_period", type=float, default=None, help="Instrument sample timer in seconds (if supported)")
    ap_live.add_argument("--range", type=float, default=None, help="Voltage range (optional)")
    ap_live.add_argument("--nplc", type=float, default=None, help="NPLC integration time (optional)")
    ap_live.add_argument("--autozero", choices=["on", "off"], default=None, help="Autozero (optional)")
    ap_live.add_argument("--update_every", type=int, default=50, help="Plot update interval (samples)")

    args = ap.parse_args()

    if args.mode == "offline":
        y = load_csv_column(args.csv, args.column)
        tau, adev = overlapping_allan_deviation(y, dt=args.dt)
        plt.figure()
        plt.loglog(tau, adev, marker="o")
        plt.grid(True, which="both", ls="--", alpha=0.5)
        plt.xlabel("Averaging time τ (s)")
        plt.ylabel("Allan deviation σ(τ) [V]")
        plt.title("Offline Allan Deviation (Voltage)")
        plt.tight_layout()
        plt.show()
        return

    # Live mode
    rm, inst = visa_open(args.resource, args.backend)
    try:
        inst.timeout = 10000  # ms; adjust if fetching large blocks
        az = None if args.autozero is None else (args.autozero == "on")
        configure_dmm_dc_voltage(inst, volt_range=args.range, nplc=args.nplc, autozero=az)

        # Choose taus (m values). Power-of-two is a good default set.
        m_values = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]

        if args.style == "poll":
            source = reader_polling_read(inst, dt=args.dt, query=args.query)
        else:
            configure_buffered_acquisition(inst, sample_count=args.block, sample_period=args.sample_period)
            source = reader_buffered_fetch(inst, sample_count=args.block)

        live_plot(source, dt=args.dt, m_values=m_values, update_every=args.update_every)

    finally:
        try:
            inst.close()
        except Exception:
            pass
        try:
            rm.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()