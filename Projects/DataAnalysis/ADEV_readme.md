# How to use it
## Offline (already-collected data)
- Put your data in data.csv with a numeric column (e.g., y).
- Set your sampling period dt.
- Uncomment the offline block in __main__.

## Live streaming from an instrument
- Replace instrument_reader_stub() with a generator that yields one numeric sample at a time.
- If your instrument is Serial (COM port), use the serial skeleton (requires pyserial).
- If your instrument is VISA (GPIB/USB/LAN), use the VISA skeleton (requires pyvisa).
### How to run
- python allan_adev_visa.py offline --csv data.csv --dt 0.1 --column voltage
- python allan_adev_visa.py live --resource "USB0::0x1234::0x5678::INSTR" --dt 0.1 --style buffer --block 200 --sample_period 0.1 --nplc 1

## Requirments
- pip install numpy matplotlib pyvisa
- pip install pyvisa-py

## Requirements for GUI
- pip install pyqt6 matplotlib numpy pandas pyvisa
- pip install pyvisa-py

