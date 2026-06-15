# TSM_core.py
#
# ★変更点（ここだけWiiリモコン→手＋カメラに置き換え）★
#   もとは Wiiリモコン(WiinRemote.exe 経由のマウス) で 1P が照準・発射していた。
#   それを Webカメラ＋手 に変更:
#     - 照準  … 人差し指の先（手の位置）
#     - 発射  … 親指と人差し指を「つまむ」
#   的の動き・スコア計算・UDP通信・2Pの受信など、その他の中身は元のまま。

import pygame
import random
import math
import sys
import time
import socket
import json
import select
import os
import threading
import queue

from hand_tracker import HandTracker  # ★追加: 手＋カメラ入力モジュール

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# UDP settings
UDP_IP = "0.0.0.0"
INPUT_PORT = 5005
SCORE_PORT = 6006

# --------------------------------------------------
SEND_IPS = ["123.123.123.1"]  # Enter the IPv4 address of the next score destination
# --------------------------------------------------

sock_input = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock_input.bind((UDP_IP, INPUT_PORT))
sock_input.setblocking(False)

sock_score_send = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock_score_recv = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock_score_recv.bind((UDP_IP, SCORE_PORT))
sock_score_recv.setblocking(False)

recv_queue = queue.Queue()

def udp_listener(sock):
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            msg = json.loads(data.decode())
            recv_queue.put(msg)
        except:
            pass

threading.Thread(target=udp_listener, args=(sock_score_recv,), daemon=True).start()

# Score exchange
pending_score = None

def send_score(score):
    message = {"player": "Player 1", "score": score}
    for ip in SEND_IPS:
        try:
            sock_score_send.sendto(json.dumps(message).encode(), (ip, SCORE_PORT))
        except Exception as e:
            print("Send error:", e)

def receive_score():
    global pending_score
    while not recv_queue.empty():
        msg = recv_queue.get()
        pending_score = msg.get("score", pending_score)
        print("Received score:", pending_score)

# Pygame Setup
pygame.init()
screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
screen_width, screen_height = screen.get_size()
pygame.mouse.set_visible(False)
pygame.display.set_caption("2-4's TOY WORLD")
clock = pygame.time.Clock()

pygame.mixer.init()

# ★追加: カメラ＋手の認識をスタート（Wiiリモコンの代わり）
hand = HandTracker()
if not hand.camera_ok():
    print("！カメラが見つかりません。hand_tracker.py の CAMERA_INDEX を確認してください。")

background_img_raw = pygame.image.load("background.jpg").convert()
background_img = pygame.transform.scale(background_img_raw, (screen_width, screen_height))
target_images_raw = [pygame.image.load(f"target{i}.png").convert_alpha() for i in range(1, 6)]

# --------------------------------------------------
TARGET_TYPES = [
    {"size": 120, "speed": 1, "score": 100, "count": 3},
    {"size": 90, "speed": 2, "score": 200, "count": 4},
    {"size": 60, "speed": 3, "score": 300, "count": 2},
] # Define 3 target types with size, speed, score, and count
# --------------------------------------------------

hit_sound = pygame.mixer.Sound("hit.mp3")
warning_sound = pygame.mixer.Sound("warning.mp3")
pygame.mixer.music.load("bgm.mp3")
pygame.mixer.music.play(-1)

font = pygame.font.SysFont(None, 72)
small_font = pygame.font.SysFont(None, 40)

STATE_START = 0
STATE_PLAYING = 1
STATE_RESULT = 2
game_state = STATE_START

score = 0
score_1p = 0
score_2p = 0
start_time = 0
game_duration = 40
last_game_state = None

class HitScore:
    def __init__(self, x, y, score):
        self.x = x
        self.y = y
        self.score = score
        self.start_time = pygame.time.get_ticks()
        self.duration = 1000

    def draw(self, surface):
        elapsed = pygame.time.get_ticks() - self.start_time
        if elapsed > self.duration:
            return False
        offset_y = - (elapsed / self.duration) * 30
        alpha = max(0, 255 - int((elapsed / self.duration) * 255))
        text_surface = small_font.render(f"+{self.score}", True, (0, 0, 0))
        text_surface.set_alpha(alpha)
        surface.blit(text_surface, (self.x, self.y + offset_y))
        return True

hit_scores = []

class Target:
    def __init__(self, target_type):
        self.set_type(target_type)
        self.reset()
        self.angle = 0
        self.rotation_speed = 0.2

    def set_type(self, target_type):
        self.size = target_type["size"]
        self.radius = self.size // 2
        self.speed_x = target_type["speed"] * random.choice([-1, 1])
        self.score_value = target_type["score"]
        self.image = pygame.transform.smoothscale(
            random.choice(target_images_raw), (self.size, self.size)
        )

    def reset(self):
        self.x = random.randint(100, screen_width - 100)
        self.base_y = random.randint(100, screen_height - 100)
        self.y = self.base_y
        self.phase = random.uniform(0, 2 * math.pi)
        self.amplitude = random.randint(10, 30)

    def update(self):
        self.x += self.speed_x
        self.y = self.base_y + self.amplitude * math.sin(pygame.time.get_ticks() / 500 + self.phase)
        if self.x < 50 or self.x > screen_width - 50:
            self.speed_x *= -1

    def draw(self, surface):
        self.angle = (self.angle + self.rotation_speed) % 360
        rotated_image = pygame.transform.rotate(self.image, self.angle)
        rect = rotated_image.get_rect(center=(int(self.x), int(self.y)))
        surface.blit(rotated_image, rect.topleft)

    def is_hit(self, pos):
        return math.hypot(pos[0] - self.x, pos[1] - self.y) < self.radius

# Helper Functions
targets = []
last_target_refresh = 0
refresh_interval = 5000

def spawn_targets():
    global targets
    targets = []
    for t_type in TARGET_TYPES:
        for _ in range(t_type["count"]):
            targets.append(Target(t_type))

def draw_text_center(text, y, font_obj):
    surface = font_obj.render(text, True, (0, 0, 0))
    rect = surface.get_rect(center=(screen_width // 2, y))
    screen.blit(surface, rect)

def draw_crosshair(pos, color=(0, 0, 0)):
    cx, cy = pos
    pygame.draw.circle(screen, color, (cx, cy), 15, 2)
    pygame.draw.line(screen, color, (cx - 20, cy), (cx + 20, cy), 2)
    pygame.draw.line(screen, color, (cx, cy - 20), (cx, cy + 20), 2)

player2_pos = [screen_width // 2, screen_height // 2]
input_locked_until = 0

# ★追加: 「発射」したときの処理をまとめた関数。
#   もとはAボタン(左クリック)で行っていた動作と同じ内容を、
#   手の「つまむ」でもマウスでも共通で呼べるようにした。
def trigger_fire(pos):
    global game_state, score, score_1p, score_2p, pending_score
    global start_time, last_target_refresh, input_locked_until
    if time.time() < input_locked_until:
        return

    if game_state == STATE_PLAYING:
        for target in targets:
            if target.is_hit(pos):
                score += target.score_value
                score_1p += target.score_value
                hit_scores.append(HitScore(target.x, target.y, target.score_value))
                target.reset()
                hit_sound.play()

    elif game_state == STATE_RESULT:
        game_state = STATE_START
        input_locked_until = time.time() + 1

    elif game_state == STATE_START:
        score = pending_score if pending_score is not None else 0
        pending_score = None
        score_1p = 0
        score_2p = 0
        game_state = STATE_PLAYING
        start_time = time.time()
        spawn_targets()
        last_target_refresh = pygame.time.get_ticks()
        input_locked_until = time.time() + 1

# Main Loop
running = True
while running:
    screen.fill((255, 255, 255))
    screen.blit(background_img, (0, 0))
    current_time = pygame.time.get_ticks()
    receive_score()

    # ★追加: カメラ＋手の入力を読む（Wiiリモコンのポインタ＆Aボタンの代わり）
    hand_norm, hand_shoot = hand.read()
    if hand_norm is not None:
        # 0〜1 の割合を画面のピクセル座標に変換
        player1_pos = (int(hand_norm[0] * screen_width),
                       int(hand_norm[1] * screen_height))
    else:
        # 手が映っていないときはマウス位置を予備として使う（無くても動く）
        player1_pos = pygame.mouse.get_pos()

    for event in pygame.event.get():
        if time.time() < input_locked_until:
            continue

        if event.type == pygame.QUIT:
            running = False

        elif event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                running = False

            elif event.key == pygame.K_RETURN:
                if game_state == STATE_START:
                    score = pending_score if pending_score is not None else 0
                    pending_score = None
                    score_1p = 0
                    score_2p = 0
                    game_state = STATE_PLAYING
                    start_time = time.time()
                    spawn_targets()
                    last_target_refresh = current_time
                    input_locked_until = time.time() + 1

                elif game_state == STATE_RESULT:
                    game_state = STATE_START
                    input_locked_until = time.time() + 1

        # マウスは予備の操作として残す（カメラが使えないときのため）
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:
                trigger_fire(pygame.mouse.get_pos())
            elif event.button == 3:
                pygame.mouse.set_pos((screen_width // 2, screen_height // 2))

    # ★追加: 手で「つまんだ」瞬間に発射（Aボタン＝左クリックと同じ動作）
    if hand_shoot:
        trigger_fire(player1_pos)

    # Player 2 Input
    ready = select.select([sock_input], [], [], 0)
    if ready[0]:
        try:
            data, _ = sock_input.recvfrom(1024)
            msg = json.loads(data.decode())
            remote_width, remote_height = msg.get("screen", [1920, 1280])
            raw_x, raw_y = msg["pos"]
            player2_pos = (int(raw_x * screen_width / remote_width),
                           int(raw_y * screen_height / remote_height))
            if msg.get("shoot"):
                for target in targets:
                    if target.is_hit(player2_pos):
                        score += target.score_value
                        score_2p += target.score_value
                        hit_scores.append(HitScore(target.x, target.y, target.score_value))
                        target.reset()
                        hit_sound.play()
        except:
            pass

    # Game State Drawing
    if game_state == STATE_START:
        draw_text_center("2-4's TOY WORLD", screen_height // 2 - 100, font)
        draw_text_center("Pinch to start", screen_height // 2, small_font)
        draw_text_center(f"Last score: {score}", screen_height // 2 + 60, small_font)
        draw_crosshair(player1_pos, (0, 0, 255))
        draw_crosshair(player2_pos, (255, 0, 0))

    elif game_state == STATE_PLAYING:
        elapsed = time.time() - start_time
        remaining = max(0, int(game_duration - elapsed))

        if remaining == 10 and not hasattr(pygame, "_warned"):
            warning_sound.play()
            pygame.warned = True
        elif remaining > 10:
            if hasattr(pygame, "_warned"):
                del pygame._warned

        for target in targets:
            hit_scores[:] = [hs for hs in hit_scores if hs.draw(screen)]
            target.update()
            target.draw(screen)

        if current_time - last_target_refresh > refresh_interval:
            spawn_targets()
            last_target_refresh = current_time

        screen.blit(small_font.render(f"Score: {score}", True, (0, 0, 0)), (30, 20))
        screen.blit(small_font.render(f"1P: {score_1p}", True, (0, 0, 0)), (30, 60))
        screen.blit(small_font.render(f"2P: {score_2p}", True, (0, 0, 0)), (30, 100))
        screen.blit(small_font.render(f"Time: {remaining}", True, (0, 0, 0)), (screen_width - 150, 20))

        draw_crosshair(player1_pos, (0, 0, 255))
        draw_crosshair(player2_pos, (255, 0, 0))

        if elapsed >= game_duration:
            game_state = STATE_RESULT
            input_locked_until = time.time() + 1

    elif game_state == STATE_RESULT:
        draw_text_center("Time up!", screen_height // 2 - 100, font)
        draw_text_center(f"Score: {score}", screen_height // 2, small_font)
        draw_text_center("Pinch to start", screen_height // 2 + 60, small_font)

    if game_state == STATE_RESULT and last_game_state != STATE_RESULT:
        send_score(score)

    last_game_state = game_state

    pygame.display.flip()
    clock.tick(60)

hand.stop()  # ★追加: 終了時にカメラを解放
pygame.quit()
sys.exit()
