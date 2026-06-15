# TSM_input.py
#
# ★変更点（ここだけWiiリモコン→手＋カメラに置き換え）★
#   2P(別マシン)の入力を、Wiiリモコン(マウス)から Webカメラ＋手 に変更。
#     - 照準  … 人差し指の先（手の位置）
#     - 発射  … 親指と人差し指を「つまむ」
#   TSM_core へ位置と発射を UDP で送る部分（通信フォーマット）は元のまま。

import pygame
import socket
import json

from hand_tracker import HandTracker  # ★追加: 手＋カメラ入力モジュール

# --------------------------------------------------
UDP_IP = "123.123.123.1" # Enter the IPv4 address of the destination
# --------------------------------------------------

UDP_PORT = 5005

pygame.init()
screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
screen_width, screen_height = screen.get_size()
pygame.display.set_caption("Player 2 Sender")
clock = pygame.time.Clock()

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

# ★追加: カメラ＋手の認識をスタート（Wiiリモコンの代わり）
hand = HandTracker()
if not hand.camera_ok():
    print("！カメラが見つかりません。hand_tracker.py の CAMERA_INDEX を確認してください。")

prev_pos = None
pos = [screen_width // 2, screen_height // 2]

while True:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            hand.stop()
            pygame.quit()
            exit()
        elif event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                hand.stop()
                pygame.quit()
                exit()

    # ★変更: マウスの代わりに手の位置・つまみを読む
    hand_norm, shoot = hand.read()
    if hand_norm is not None:
        # 0〜1 の割合を、このマシンの画面サイズに合わせたピクセル座標に変換
        pos = [int(hand_norm[0] * screen_width), int(hand_norm[1] * screen_height)]

    # 位置が動いた、または発射したときだけ送信（元の仕様どおり）
    if pos != prev_pos or shoot:
        message = {
            "pos": pos,
            "shoot": shoot,
            "screen": [screen_width, screen_height]
        }
        sock.sendto(json.dumps(message).encode(), (UDP_IP, UDP_PORT))
        prev_pos = list(pos)

    # 画面に自分の照準を表示（青=狙い, 赤=発射の瞬間）
    screen.fill((200, 200, 200))
    color = (255, 0, 0) if shoot else (0, 0, 255)
    pygame.draw.circle(screen, color, pos, 12)
    pygame.display.flip()
    clock.tick(60)
