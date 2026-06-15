# hand_tracker.py
#
# Wiiリモコン＋センサーバーの代わりに、Webカメラと「手」で照準・発射を行うための共通モジュール。
# このファイル単体ではゲームにならない。TSM_core.py / TSM_input.py から呼び出して使う「部品」。
#
# 仕組み（むずかしい用語の補足つき）:
#   - OpenCV(オープンシーヴィー)      … カメラの映像を1コマずつ受け取るライブラリ
#   - MediaPipe(メディアパイプ)       … Googleが無料公開している、手の指の位置を見つけるAI
#   この2つを使って「人差し指の先＝照準」「親指と人差し指をつまむ＝発射」を判定する。
#
# 必要なインストール（無料）:
#   pip install opencv-python mediapipe numpy
#
# 提供する機能:
#   tracker = HandTracker()      … カメラを起動して手の認識を開始
#   pos, shoot = tracker.read()  … 毎フレーム呼ぶ。
#        pos   … (x, y) を 0.0〜1.0 で返す（画面の割合）。手が映っていなければ None
#        shoot … 「つまむ」動作をした瞬間だけ True（押しっぱなしでは連射しない）
#   tracker.stop()               … 終了処理（カメラを解放）

import threading
import time

import cv2
import numpy as np
import mediapipe as mp


class HandTracker:
    # --------------------------------------------------------------
    # 調整用のパラメータ（必要ならここだけ書き換えればOK）
    # --------------------------------------------------------------
    CAMERA_INDEX = 0        # 使うカメラの番号。内蔵カメラ=0、USBカメラを使うなら 1 などに変更
    MIRROR = True           # True にすると鏡のように左右反転（手を動かした向きと画面が一致して自然）
    SMOOTHING = 0.5         # 照準のなめらかさ。0=即時/手ブレあり, 1に近いほど滑らかだが遅れる
    PINCH_ON = 0.45         # この値より親指と人差し指が近づいたら「つまんだ」と判定
    PINCH_OFF = 0.65        # この値より離れたら「つまむのをやめた」と判定（ばたつき防止）
    SHOOT_COOLDOWN = 0.25   # 連続発射の最短間隔（秒）。つまみっぱなしの誤連射を防ぐ
    # --------------------------------------------------------------

    def __init__(self, camera_index=None, show_preview=False):
        self._mp_hands = mp.solutions.hands
        self._hands = self._mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=1,           # 1人=片手だけ追う（処理を軽くするため）
            min_detection_confidence=0.6,
            min_tracking_confidence=0.5,
        )
        self._camera_index = self.CAMERA_INDEX if camera_index is None else camera_index
        self._show_preview = show_preview   # True にすると別ウィンドウにカメラ映像を表示（位置合わせ用）

        # 複数スレッドから安全に値をやり取りするためのロック
        self._lock = threading.Lock()
        self._pos = None            # 最新の照準位置 (x, y) 0〜1。手が無ければ None
        self._shoot_pending = False  # 「つまんだ瞬間」が起きたら True。read() が読むと False に戻る
        self._pinching = False       # いま、つまんでいる最中かどうか
        self._last_shoot_time = 0.0
        self._smoothed = None        # なめらか化した座標を覚えておく

        self._running = True
        self._cap = cv2.VideoCapture(self._camera_index)
        # カメラ画像はそこまで高解像度でなくてよい（処理を軽くする）
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        # 別スレッドでカメラを回し続ける（ゲーム本体の動きを止めないため）
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def camera_ok(self):
        """カメラが正しく開けているかを返す。"""
        return self._cap is not None and self._cap.isOpened()

    def _loop(self):
        while self._running:
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(0.01)
                continue

            if self.MIRROR:
                frame = cv2.flip(frame, 1)  # 左右反転（鏡うつし）

            # MediaPipe は RGB(色の順番)を期待するので変換する
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = self._hands.process(rgb)

            if result.multi_hand_landmarks:
                hand = result.multi_hand_landmarks[0]
                lm = hand.landmark

                # ランドマーク番号: 4=親指の先, 8=人差し指の先, 0=手首, 5=人差し指の付け根
                index_tip = lm[8]
                thumb_tip = lm[4]
                wrist = lm[0]
                index_mcp = lm[5]

                # --- 照準位置（人差し指の先） ---
                raw = (index_tip.x, index_tip.y)
                if self._smoothed is None:
                    self._smoothed = raw
                else:
                    s = self.SMOOTHING
                    self._smoothed = (
                        self._smoothed[0] * s + raw[0] * (1 - s),
                        self._smoothed[1] * s + raw[1] * (1 - s),
                    )

                # --- つまみ具合の計算 ---
                # 親指の先と人差し指の先の距離を、手の大きさ(手首〜人差し指付け根)で割って正規化。
                # こうすると、カメラに近い/遠いで手の大きさが変わっても判定がブレにくい。
                pinch_dist = np.hypot(thumb_tip.x - index_tip.x, thumb_tip.y - index_tip.y)
                hand_size = np.hypot(wrist.x - index_mcp.x, wrist.y - index_mcp.y) + 1e-6
                pinch_ratio = pinch_dist / hand_size

                self._update_state(self._smoothed, pinch_ratio)

                if self._show_preview:
                    h, w, _ = frame.shape
                    cx, cy = int(self._smoothed[0] * w), int(self._smoothed[1] * h)
                    color = (0, 0, 255) if self._pinching else (0, 200, 0)
                    cv2.circle(frame, (cx, cy), 12, color, 2)
            else:
                # 手が映っていない
                with self._lock:
                    self._pos = None
                self._smoothed = None
                self._pinching = False

            if self._show_preview:
                cv2.imshow("Hand Camera (press q to hide)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    self._show_preview = False
                    cv2.destroyWindow("Hand Camera (press q to hide)")

    def _update_state(self, pos, pinch_ratio):
        now = time.time()
        with self._lock:
            self._pos = pos

            if not self._pinching and pinch_ratio < self.PINCH_ON:
                # 「開いた状態」→「つまんだ瞬間」= 発射トリガー
                self._pinching = True
                if now - self._last_shoot_time >= self.SHOOT_COOLDOWN:
                    self._shoot_pending = True
                    self._last_shoot_time = now
            elif self._pinching and pinch_ratio > self.PINCH_OFF:
                # 指を離した = 次のつまみで再び撃てる状態に戻す
                self._pinching = False

    def read(self):
        """毎フレーム呼ぶ。(pos, shoot) を返す。
        pos   … (x, y) 0.0〜1.0、手が無ければ None
        shoot … つまんだ瞬間だけ True（読むと自動でリセットされる）
        """
        with self._lock:
            pos = self._pos
            shoot = self._shoot_pending
            self._shoot_pending = False
        return pos, shoot

    def stop(self):
        self._running = False
        time.sleep(0.05)
        if self._cap is not None:
            self._cap.release()
        if self._show_preview:
            cv2.destroyAllWindows()


# このファイルを直接実行すると、カメラと手の認識が動くかを確認できる（位置合わせ・動作テスト用）。
#   python hand_tracker.py
if __name__ == "__main__":
    print("カメラと手の認識をテストします。'q' でプレビューを閉じ、Ctrl+C で終了。")
    t = HandTracker(show_preview=True)
    if not t.camera_ok():
        print("！カメラを開けませんでした。CAMERA_INDEX の番号を変えて試してください。")
    try:
        while True:
            pos, shoot = t.read()
            if shoot:
                print("BANG! 発射 at", pos)
            time.sleep(0.03)
    except KeyboardInterrupt:
        pass
    finally:
        t.stop()
