import time
import math
import threading
from collections import deque
from dataclasses import dataclass
from typing import Iterable, Optional, Callable, List, Tuple

import numpy as np
import matplotlib.pyplot as plt


# ----------------------------
# OFFLINE: Allan deviation
# ----------------------------
def overlapping_allan_deviation(y: np.ndarray, dt: float,
                                taus: Optional[np.ndarray] = None,
                                m_values: Optional[np.ndarray] = None) -> Tuple[np.ndarray, np.ndarray]:
    """
    Compute overlapping Allan deviation for a uniformly sampled time series y[k].

    Parameters
    ----------
    y : np.ndarray
        1D array of samples (e.g., fractional frequency).
    dt : float
        Sample period in seconds.
    taus : Optional[np.ndarray]
        Desired tau values (seconds). Will be converted to m = round(tau/dt).
        If provided, overrides m_values.
    m_values : Optional[np.ndarray]
        Averaging factors in samples (m). tau = m * dt.

    Returns
    -------
    tau_out : np.ndarray
        Tau values (seconds).
    adev : np.ndarray
        Allan deviation for each tau.
    """
    y = np.asarray(y, dtype=float).ravel()
    n = len(y)
    if n < 3:
        raise ValueError("Need at least 3 samples to compute Allan deviation.")

    if taus is not None:
        taus = np.asarray(taus, dtype=float)
        m_values = np.unique(np.clip(np.rint(taus / dt).astype(int), 1, n // 2))
    elif m_values is None:
        # default: powers of 2 up to n/2
        max_m = max(1, n // 2)
        m_values = 2 ** np.arange(0, int(np.floor(np.log2(max_m))) + 1, dtype=int)
    else:
        m_values = np.unique(np.asarray(m_values, dtype=int))
        m_values = m_values[(m_values >= 1) & (m_values <= n // 2)]

    tau_out = m_values * dt
    adev = np.full_like(tau_out, np.nan, dtype=float)

    # Efficient overlapping AVAR computation using cumulative sum
    csum = np.concatenate(([0.0], np.cumsum(y)))
    for i, m in enumerate(m_values):
        # compute moving averages of length m: ybar[k] = (y[k:k+m].sum)/m for k=0..n-m
        ybar = (csum[m:] - csum[:-m]) / m
        if len(ybar) < 2:
            continue
        dy = np.diff(ybar)                 # ybar[k+1] - ybar[k]
        avar = 0.5 * np.mean(dy * dy)
        adev[i] = math.sqrt(avar)

    return tau_out, adev


def plot_adev(tau: np.ndarray, adev: np.ndarray, title: str = "Allan Deviation"):
    plt.figure()
    plt.loglog(tau, adev, marker="o")
    plt.grid(True, which="both", ls="--", alpha=0.5)
    plt.xlabel("Averaging time τ (s)")
    plt.ylabel("Allan deviation σy(τ)")
    plt.title(title)
    plt.tight_layout()
    plt.show()


# ----------------------------
# LIVE STREAM: incremental Allan deviation estimator
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
        # Update rolling sum/window
        if len(self.window) == self.window.maxlen:
            oldest = self.window.popleft()
            self.running_sum -= oldest
        self.window.append(sample)
        self.running_sum += sample

        # When full, compute avg and incremental AVAR
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
    """
    Incremental (streaming) Allan deviation estimator for multiple taus (m values).

    This uses overlapping averages with step size 1 sample.
    """
    def __init__(self, dt: float, m_values: Iterable[int]):
        self.dt = float(dt)
        m_values = sorted(set(int(m) for m in m_values if m >= 1))
        if not m_values:
            raise ValueError("m_values must contain at least one integer >= 1.")
        self.states = [
            TauState(m=m, window=deque(maxlen=m))
            for m in m_values
        ]
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
# Instrument reading templates
# ----------------------------
def instrument_reader_stub() -> Iterable[float]:
    """
    Replace this generator with your instrument read loop.
    It should yield one float sample at a time.

    Below is a simulation: white noise + slow drift.
    """
    rng = np.random.default_rng(0)
    x = 0.0
    while True:
        x += 1e-6  # drift
        yield x + rng.normal(scale=1e-3)
        time.sleep(0.01)  # simulate ~100 Hz sampling


# Example: serial reader skeleton (requires pyserial)
# def instrument_reader_serial(port: str, baudrate: int = 115200, parse: Callable[[str], float] = float):
#     import serial
#     with serial.Serial(port, baudrate, timeout=1) as ser:
#         while True:
#             line = ser.readline().decode(errors="ignore").strip()
#             if not line:
#                 continue
#             try:
#                 yield parse(line)
#             except ValueError:
#                 continue


# Example: VISA reader skeleton (requires pyvisa)
# def instrument_reader_visa(resource: str, query: str = "READ?"):
#     import pyvisa
#     rm = pyvisa.ResourceManager()
#     inst = rm.open_resource(resource)
#     try:
#         while True:
#             val = float(inst.query(query).strip())
#             yield val
#     finally:
#         inst.close()


# ----------------------------
# LIVE plotting
# ----------------------------
def live_plot_allan_deviation(
    sample_source: Iterable[float],
    dt: float,
    max_points: int = 20000,
    update_every: int = 50,
    m_values: Optional[List[int]] = None,
    title: str = "Live Allan Deviation"
):
    """
    Continuously read samples, update streaming Allan deviation, and refresh plot.
    """
    if m_values is None:
        # Choose power-of-two m values up to what a typical buffer could support
        # For streaming we don't strictly need a global buffer, but large m needs enough time to converge.
        m_values = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]

    streamer = AllanDeviationStreamer(dt=dt, m_values=m_values)

    # Optional: keep a finite buffer of raw samples (not required for the streaming estimator)
    raw = deque(maxlen=max_points)

    plt.ion()
    fig, ax = plt.subplots()
    line, = ax.loglog([], [], marker="o")
    ax.grid(True, which="both", ls="--", alpha=0.5)
    ax.set_xlabel("Averaging time τ (s)")
    ax.set_ylabel("Allan deviation σy(τ)")
    ax.set_title(title)

    samples_seen = 0
    last_draw = time.time()

    for sample in sample_source:
        raw.append(sample)
        streamer.update(sample)
        samples_seen += 1

        if samples_seen % update_every == 0:
            tau = streamer.taus
            adev = streamer.current_adev()

            # Only plot taus that currently have estimates
            mask = np.isfinite(adev)
            if np.any(mask):
                line.set_data(tau[mask], adev[mask])
                ax.relim()
                ax.autoscale_view()
                fig.canvas.draw()
                fig.canvas.flush_events()

            # Optional: throttle UI if needed
            now = time.time()
            if now - last_draw < 0.02:
                time.sleep(0.02 - (now - last_draw))
            last_draw = now


# ----------------------------
# OFFLINE workflow helpers
# ----------------------------
def load_csv_column(path: str, column: Optional[str] = None) -> np.ndarray:
    """
    Load a single column from a CSV. If column is None, loads the first numeric column.
    """
    import pandas as pd
    df = pd.read_csv(path)

    if column is not None:
        y = df[column].to_numpy(dtype=float)
        return y

    # pick first numeric column
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not num_cols:
        raise ValueError("No numeric columns found in CSV. Specify a column name.")
    return df[num_cols[0]].to_numpy(dtype=float)


# ----------------------------
# Example usage
# ----------------------------
if __name__ == "__main__":
    # -------- OFFLINE EXAMPLE --------
    # Uncomment to run offline analysis:
    #
    # dt = 0.01  # seconds
    # y = load_csv_column("data.csv", column=None)  # or specify column="freq_error"
    # tau, adev = overlapping_allan_deviation(y, dt)
    # plot_adev(tau, adev, title="Offline Allan Deviation")

    # -------- LIVE EXAMPLE --------
    dt = 0.01  # sample period (s) - set this to your instrument sampling interval
    source = instrument_reader_stub()  # replace with instrument_reader_serial(...) or instrument_reader_visa(...)
    live_plot_allan_deviation(source, dt=dt, update_every=25, title="Live Allan Deviation")