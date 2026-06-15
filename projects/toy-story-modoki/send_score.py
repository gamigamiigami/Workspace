import socket
import json

UDP_IP = "172.24.8.103"  # TSM_score が動作しているマシンのIP
UDP_PORT = 6006

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

score = int(input("送信するスコアを入力: "))

message = json.dumps({"score": score}).encode()
sock.sendto(message, (UDP_IP, UDP_PORT))

print(f"Score {score} を {UDP_IP}:{UDP_PORT} に送信しました")
