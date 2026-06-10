import sys
import csv
import os
from datetime import datetime

import cv2

from PyQt6.QtCore import Qt, QThread, pyqtSignal, QUrl
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QLabel, QPushButton,
    QListWidget, QHBoxLayout, QVBoxLayout, QFileDialog
)
from PyQt6.QtMultimedia import QSoundEffect


# Convert OpenCV frame to Qt image
def cv_to_qimage(frame):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    h, w, ch = rgb.shape
    return QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888)


# ✅ PRO CAMERA THREAD (NO ZBAR)
class CameraWorker(QThread):
    frame_ready = pyqtSignal(QImage)
    barcode_found = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.running = False
        self.cap = None
        self.seen_codes = set()

        # ✅ OpenCV native barcode detector
        self.detector = cv2.barcode_BarcodeDetector()

    def run(self):
        print("▶ Pro scanner starting")
        self.running = True

        try:
            self.cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)

            if not self.cap.isOpened():
                print("❌ Camera failed")
                return

            # Lower resolution = better edge detection
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

            print("✅ Camera running")

            while self.running:
                ret, frame = self.cap.read()
                if not ret:
                    continue

                h, w = frame.shape[:2]

                # ✅ Focus on center region (huge improvement)
                roi = frame[int(h*0.3):int(h*0.7), int(w*0.2):int(w*0.8)]

                # ✅ Upscale for better detection
                roi_big = cv2.resize(roi, None, fx=2.0, fy=2.0)

                # ✅ Improve contrast
                gray = cv2.cvtColor(roi_big, cv2.COLOR_BGR2GRAY)
                gray = cv2.convertScaleAbs(gray, alpha=2.0)

                # ✅ Detect + decode barcode
                decoded_info = []

                try:
                    # 1️⃣ BIG upscale (critical for small ID barcodes)
                    roi_big = cv2.resize(roi, None, fx=3.0, fy=3.0)

                    gray = cv2.cvtColor(roi_big, cv2.COLOR_BGR2GRAY)

                    # 2️⃣ Strong contrast boost
                    gray = cv2.convertScaleAbs(gray, alpha=3.0, beta=0)

                    # 3️⃣ Edge enhancement (GOOD for 1D lines)
                    edges = cv2.Sobel(gray, cv2.CV_8U, 1, 0, ksize=3)

                    # 4️⃣ Try multiple detection passes

                    # Pass 1: edges (best for 1D)
                    result = self.detector.detectAndDecode(edges)

                    if len(result) == 4:
                        ok, decoded_info, _, _ = result
                    else:
                        ok, decoded_info, _ = result

                    # Pass 2: grayscale
                    if not decoded_info:
                        result = self.detector.detectAndDecode(gray)
                        if len(result) == 4:
                            ok, decoded_info, _, _ = result
                        else:
                            ok, decoded_info, _ = result

                except Exception as e:
                    print("Detection error:", e)

                # Handle both cases (3 or 4 return values)
                if len(result) == 4:
                    ok, decoded_info, decoded_type, points = result
                else:
                    ok, decoded_info, points = result

                
                if decoded_info:
                    for code in decoded_info:
                        if code and code not in self.seen_codes:
                            self.seen_codes.add(code)
                            self.barcode_found.emit(code)


                # ✅ Draw overlay box
                cv2.rectangle(frame,
                              (int(w*0.1), int(h*0.25)),
                              (int(w*0.9), int(h*0.75)),
                              (0, 255, 0), 2)

                self.frame_ready.emit(cv_to_qimage(frame))

        except Exception as e:
            print("🔥 Scanner error:", e)

        finally:
            if self.cap:
                self.cap.release()
            print("🛑 Scanner stopped")

    def stop(self):
        self.running = False
        self.wait()


# ✅ GUI
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("PRO 1D Barcode Scanner")
        self.setMinimumSize(900, 600)

        self.csv_file = "scans.csv"
        self.worker = None

        # UI
        self.video_label = QLabel()
        self.video_label.setStyleSheet("background:black")

        self.list_widget = QListWidget()

        self.start_btn = QPushButton("Start")
        self.stop_btn = QPushButton("Stop")
        self.stop_btn.setEnabled(False)

        self.reset_btn = QPushButton("Reset")
        self.csv_btn = QPushButton("CSV File")

        # Layout
        left = QVBoxLayout()
        left.addWidget(self.video_label)

        right = QVBoxLayout()
        right.addWidget(self.list_widget)
        right.addWidget(self.start_btn)
        right.addWidget(self.stop_btn)
        right.addWidget(self.reset_btn)
        right.addWidget(self.csv_btn)

        layout = QHBoxLayout()
        layout.addLayout(left, 2)
        layout.addLayout(right, 1)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        # Sound
        self.sound = QSoundEffect()
        wav = os.path.join(os.getcwd(), "beep.wav")
        if os.path.exists(wav):
            self.sound.setSource(QUrl.fromLocalFile(wav))
        self.sound.setVolume(0.8)

        # Signals
        self.start_btn.clicked.connect(self.start)
        self.stop_btn.clicked.connect(self.stop)
        self.reset_btn.clicked.connect(self.reset)
        self.csv_btn.clicked.connect(self.choose_csv)

        self.init_csv()

    def init_csv(self):
        if not os.path.exists(self.csv_file):
            with open(self.csv_file, "w", newline="") as f:
                csv.writer(f).writerow(["timestamp", "barcode"])

    def choose_csv(self):
        file, _ = QFileDialog.getSaveFileName(self, "CSV File", "", "CSV (*.csv)")
        if file:
            self.csv_file = file
            self.init_csv()

    def start(self):
        self.worker = CameraWorker()
        self.worker.frame_ready.connect(self.update)
        self.worker.barcode_found.connect(self.save_barcode)
        self.worker.start()

        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)

    def stop(self):
        if self.worker:
            self.worker.stop()
            self.worker = None

        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)

    def reset(self):
        self.list_widget.clear()
        if self.worker:
            self.worker.seen_codes.clear()

    def update(self, img):
        pix = QPixmap.fromImage(img)
        self.video_label.setPixmap(pix.scaled(
            self.video_label.size(),
            Qt.AspectRatioMode.KeepAspectRatio
        ))

    def save_barcode(self, code):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        self.list_widget.insertItem(0, f"{ts} | {code}")

        with open(self.csv_file, "a", newline="") as f:
            csv.writer(f).writerow([ts, code])

        if self.sound.source():
            self.sound.play()
        else:
            QApplication.beep()

    def closeEvent(self, event):
        if self.worker:
            self.worker.stop()
        event.accept()


def main():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
