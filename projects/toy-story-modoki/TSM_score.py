# TSM_score

import pygame
import socket
import json
import tkinter as tk
from tkinter import simpledialog
import os
import glob

UDP_PORT = 6006

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("0.0.0.0", UDP_PORT))
sock.setblocking(False)

pygame.init()
screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
pygame.display.set_caption("2-4's TOY WORLD - Scoreboard")
clock = pygame.time.Clock()

font_title = pygame.font.SysFont(None, 80)
font_entry = pygame.font.SysFont(None, 50)

scores = []
player_count = 1
show_calling = True

current_calling = None
latest_ticket = 0
scroll_offset = 0

script_dir = os.path.dirname(os.path.abspath(__file__))
ranking_file = os.path.join(script_dir, "ranking.txt")

def save_ranking():
    with open(ranking_file, "w", encoding="utf-8") as f:
        sorted_scores = sorted(scores, key=lambda x: x["score"], reverse=True)
        for idx, entry in enumerate(sorted_scores):
            display_name = entry.get("nickname") or f"#{entry['ticket']}"
            f.write(f"{idx + 1} {display_name} - {entry['score']}\n")

def load_ranking_from_file(path, file_index=None):
    loaded = []
    if not os.path.exists(path):
        return loaded
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 3:
                try:
                    rank = int(parts[0])
                    name = parts[1]
                    score = int(parts[-1])
                    loaded.append({
                        "player": name,
                        "nickname": name if not name.startswith("#") else "",
                        "ticket": rank,
                        "score": score,
                        "file_index": file_index
                    })
                except ValueError:
                    continue
    return loaded


def load_all_rankings():
    scores.clear()
    
    scores.extend(load_ranking_from_file(ranking_file, file_index=0))
    
    past_files = sorted(glob.glob(os.path.join(script_dir, "ranking[1-9]*.txt")))
    for f in past_files:
        try:
            basename = os.path.basename(f)
            file_index = int(basename.replace("ranking", "").replace(".txt", ""))
            scores.extend(load_ranking_from_file(f, file_index=file_index))
        except Exception:
            continue

    scores.sort(key=lambda x: x["score"], reverse=True)

    for idx, entry in enumerate(scores):
        entry["ticket"] = idx + 1

def draw_scoreboard():
    screen.fill((30, 30, 30))
    title = font_title.render("High Scores", True, (255, 255, 255))
    screen.blit(title, (screen.get_width() // 2 - title.get_width() // 2, 50))

    # Now Calling
    if show_calling and current_calling is not None:
        calling_text = font_entry.render(f"Now Calling: #{current_calling}", True, (0, 255, 0))
        screen.blit(calling_text, (screen.get_width() // 2 - calling_text.get_width() // 2, 120))

    sorted_scores = sorted(scores, key=lambda x: x["score"], reverse=True)
    visible_scores = sorted_scores[scroll_offset:scroll_offset + 10]

    for idx, entry in enumerate(visible_scores):
        display_name = entry.get("nickname") or f"#{entry['ticket']}"
        line = f"{scroll_offset + idx + 1} {display_name} - {entry['score']}"
        text = font_entry.render(line, True, (255, 215, 0))
        screen.blit(text, (100, 180 + idx * 40))

    pygame.display.flip()

def edit_nickname():
    if not scores:
        return
    root = tk.Tk()
    root.withdraw()

    ticket_list = [str(e["ticket"]) for e in scores]
    ticket_to_edit = simpledialog.askstring(
        "Select Ticket",
        f"Current tickets: {', '.join(ticket_list)}\nEnter ticket number to edit:"
    )
    if not ticket_to_edit:
        return

    for entry in scores:
        if str(entry["ticket"]) == ticket_to_edit:
            new_name = simpledialog.askstring("New Name", f"Enter new name for ticket #{ticket_to_edit}:")
            if new_name:
                entry["nickname"] = new_name
                save_ranking()
            break

running = True
load_all_rankings()

while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False

        elif event.type == pygame.KEYDOWN:
            if event.key == pygame.K_c:
                show_calling = not show_calling
                if show_calling:
                    current_calling = latest_ticket + 1
            elif event.key == pygame.K_e:
                edit_nickname()
            elif event.key == pygame.K_UP:
                if scroll_offset > 0:
                    scroll_offset -= 1
            elif event.key == pygame.K_DOWN:
                if scroll_offset < max(0, len(scores) - 10):
                    scroll_offset += 1
            elif event.key == pygame.K_r:
                load_all_rankings()

    try:
        data, _ = sock.recvfrom(1024)
        msg = json.loads(data.decode())
        score = msg.get("score", 0)

        new_entry = {
            "player": f"Player {player_count}",
            "score": score,
            "ticket": len(scores) + 1,
            "nickname": "",
            "file_index": 0
        }
        scores.append(new_entry)

        latest_ticket = new_entry["ticket"]
        if show_calling:
            current_calling = latest_ticket + 1

        player_count += 1
        save_ranking()

    except (BlockingIOError, json.JSONDecodeError):
        pass

    draw_scoreboard()
    clock.tick(30)

pygame.quit()
