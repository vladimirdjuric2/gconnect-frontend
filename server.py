#!/usr/bin/env python3
import os
import sys
import json
import socket
import mimetypes
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# Eksplicitno mapiramo mimetypes za pravilan rad u svim sistemima
mimetypes.init()
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('image/svg+xml', '.svg')

PORT = int(os.environ.get('PORT', 8000))
DATA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'konfiguracija.json')
NJIVE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'njive.json')
OPSTINE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'opstine.json')
PODESAVANJA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'podesavanja.json')
ZONE_ZALIVANJA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'zone-zalivanja.json')

def send_udp_packet(ip, port, message, wait_response=False, timeout=0.15):
    """
    Šalje UDP paket ka Arduino Uno ploči i opciono čeka odgovor (sa kratkim timeout-om).
    Vraća (uspeh, primljeni_odgovor)
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        # Slanje sirovog UDP paketa
        sock.sendto(message.encode('utf-8'), (ip, port))
        
        if wait_response:
            # Čekanje odgovora sa Arduina
            data, addr = sock.recvfrom(1024)
            return True, data.decode('utf-8', errors='ignore').strip()
        return True, "SENT_WITHOUT_WAIT"
    except socket.timeout:
        return False, "TIMEOUT"
    except Exception as e:
        return False, f"ERR: {str(e)}"
    finally:
        sock.close()

class IrigacijaHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Omogućavamo CORS radi lakšeg testiranja i otklanjanja grešaka
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        
        # Sprečavanje agresivnog keširanja statičkih fajlova (JS, CSS, HTML) na lokalu
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        
        super().end_headers()

    def do_OPTIONS(self):
        # Odgovor na pre-flight zahteve
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)
        
        # --- 1. UDP GATEWAY PREKO GET METODE ---
        if parsed_url.path == '/api/udp-relay':
            ip = query_params.get('ip', [''])[0]
            port_str = query_params.get('port', ['8888'])[0]
            msg = query_params.get('msg', [''])[0]
            wait_resp = query_params.get('wait_response', ['false'])[0].lower() == 'true'
            
            if not ip or not msg:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Parametri 'ip' i 'msg' su obavezni."}).encode('utf-8'))
                return
                
            try:
                port = int(port_str)
            except ValueError:
                port = 8888
                
            uspeh, odgovor = send_udp_packet(ip, port, msg, wait_response=wait_resp)
            
            # Vraćamo 200 u oba slučaja, ali uspeh u polju "success" kako klijent ne bi bacao mrežni krah
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": uspeh,
                "msg_sent": msg,
                "response": odgovor
            }, ensure_ascii=False).encode('utf-8'))
            print(f"[UDP RELAY GET] Poslato na {ip}:{port} -> '{msg}' | Odgovor: '{odgovor}' (Uspeh: {uspeh})")
            return
            
        # --- 2. UČITAVANJE NJIVA (GET) ---
        elif parsed_url.path == '/api/njive' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'njive'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            if os.path.exists(NJIVE_FILE):
                try:
                    with open(NJIVE_FILE, 'r', encoding='utf-8') as f:
                        data = f.read()
                        if not data.strip():
                            data = '[]'
                        self.wfile.write(data.encode('utf-8'))
                except Exception as e:
                    self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            else:
                self.wfile.write(b'[]')
            return
            
        # --- 2.2 UČITAVANJE ZONE ZALIVANJA (GET) ---
        elif parsed_url.path == '/api/zone-zalivanja' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'zone-zalivanja'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            if os.path.exists(ZONE_ZALIVANJA_FILE):
                try:
                    with open(ZONE_ZALIVANJA_FILE, 'r', encoding='utf-8') as f:
                        data = f.read()
                        if not data.strip():
                            data = '[]'
                        self.wfile.write(data.encode('utf-8'))
                except Exception as e:
                    self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            else:
                self.wfile.write(b'[]')
            return
            
        # --- 2.5 UČITAVANJE OPŠTINA (GET) ---
        elif parsed_url.path == '/api/opstine' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'opstine'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            try:
                # Fajl je garantovano inicijalizovan pri pokretanju
                with open(OPSTINE_FILE, 'r', encoding='utf-8') as f:
                    data = f.read()
                    if not data.strip():
                        data = '[]'
                    self.wfile.write(data.encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
            
        # --- 2.7 UČITAVANJE PODEŠAVANJA (GET) ---
        elif parsed_url.path == '/api/podesavanja' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'podesavanja'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            try:
                with open(PODESAVANJA_FILE, 'r', encoding='utf-8') as f:
                    data = f.read()
                    if not data.strip():
                        data = '{}'
                    self.wfile.write(data.encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return
            
        # --- 3. UČITAVANJE RASPOREDA (GET) ---
        elif parsed_url.path == '/api/layout' or parsed_url.path == '/api.php':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            
            if os.path.exists(DATA_FILE):
                try:
                    with open(DATA_FILE, 'r', encoding='utf-8') as f:
                        data = f.read()
                        if not data.strip():
                            data = '{"devices":[], "pipes":[]}'
                        self.wfile.write(data.encode('utf-8'))
                except Exception as e:
                    self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            else:
                self.wfile.write(b'{"devices":[], "pipes":[]}')
            return
            
        # --- 4. SERVIRANJE STATIČKIH FAJLOVA ---
        else:
            # Očisti putanju od query parametara (npr. ?v=1.2.2) kako bi ugrađeni SimpleHTTPRequestHandler
            # uvek ispravno locirao fajl na disku, dok pretraživač i dalje uspešno zaobilazi keš.
            clean_path = parsed_url.path
            if clean_path == '/' or clean_path == '':
                clean_path = '/index.html'
            self.path = clean_path
            super().do_GET()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)
        
        # --- 1. UDP GATEWAY PREKO POST METODE (JSON payload) ---
        if parsed_url.path == '/api/udp-relay':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                params = json.loads(post_data.decode('utf-8'))
                ip = params.get('ip', '')
                port_val = params.get('port', 8888)
                msg = params.get('msg', '')
                wait_resp = params.get('wait_response', False)
                
                if not ip or not msg:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Polja 'ip' i 'msg' su obavezna u JSON-u."}).encode('utf-8'))
                    return
                
                try:
                    port = int(port_val)
                except (ValueError, TypeError):
                    port = 8888
                    
                uspeh, odgovor = send_udp_packet(ip, port, msg, wait_response=wait_resp)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": uspeh,
                    "msg_sent": msg,
                    "response": odgovor
                }, ensure_ascii=False).encode('utf-8'))
                print(f"[UDP RELAY POST] Poslato na {ip}:{port} -> '{msg}' | Odgovor: '{odgovor}' (Uspeh: {uspeh})")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Greška pri parsiranju JSON-a: {str(e)}"}).encode('utf-8'))
            return

        # --- 2. ČUVANJE NJIVA (POST) ---
        elif parsed_url.path == '/api/njive' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'njive'):
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                decoded = json.loads(post_data.decode('utf-8'))
                os.makedirs(os.path.dirname(NJIVE_FILE), exist_ok=True)
                
                with open(NJIVE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(decoded, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                print(f"[OK] Podaci o njivama uspešno upisani na disk ({len(post_data)} bajtova).")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Greška pri upisu njiva: {str(e)}"}).encode('utf-8'))
                print(f"[GREŠKA] Neuspešan upis njiva: {str(e)}")
            return

        # --- 2.2 ČUVANJE ZONE ZALIVANJA (POST) ---
        elif parsed_url.path == '/api/zone-zalivanja' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'zone-zalivanja'):
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                decoded = json.loads(post_data.decode('utf-8'))
                os.makedirs(os.path.dirname(ZONE_ZALIVANJA_FILE), exist_ok=True)
                
                with open(ZONE_ZALIVANJA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(decoded, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                print(f"[OK] Podaci o zonama zalivanja uspešno upisani na disk ({len(post_data)} bajtova).")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Greška pri upisu zona: {str(e)}"}).encode('utf-8'))
                print(f"[GREŠKA] Neuspešan upis zona: {str(e)}")
            return

        # --- 2.5 ČUVANJE OPŠTINA (POST) ---
        elif parsed_url.path == '/api/opstine' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'opstine'):
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                decoded = json.loads(post_data.decode('utf-8'))
                os.makedirs(os.path.dirname(OPSTINE_FILE), exist_ok=True)
                
                with open(OPSTINE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(decoded, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                print(f"[OK] Podaci o opštinama uspešno upisani na disk ({len(post_data)} bajtova).")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Greška pri upisu opština: {str(e)}"}).encode('utf-8'))
                print(f"[GREŠKA] Neuspešan upis opština: {str(e)}")
            return

        # --- 2.7 ČUVANJE PODEŠAVANJA (POST) ---
        elif parsed_url.path == '/api/podesavanja' or (parsed_url.path == '/api.php' and query_params.get('action', [''])[0] == 'podesavanja'):
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                decoded = json.loads(post_data.decode('utf-8'))
                os.makedirs(os.path.dirname(PODESAVANJA_FILE), exist_ok=True)
                
                with open(PODESAVANJA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(decoded, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                print(f"[OK] Podešavanja uspešno upisana na disk ({len(post_data)} bajtova).")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Greška pri upisu podešavanja: {str(e)}"}).encode('utf-8'))
                print(f"[GREŠKA] Neuspešan upis podešavanja: {str(e)}")
            return
            
        # --- 3. ČUVANJE RASPOREDA (POST) ---
        elif parsed_url.path == '/api/layout' or parsed_url.path == '/api.php':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                decoded = json.loads(post_data.decode('utf-8'))
                os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
                
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(decoded, f, indent=4, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                print(f"[OK] Raspored uspešno upisan na disk ({len(post_data)} bajtova).")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Greška pri upisu: {str(e)}"}).encode('utf-8'))
                print(f"[GREŠKA] Neuspešan upis konfiguracije: {str(e)}")
            return
        else:
            self.send_response(404)
            self.end_headers()

def osiguraj_fajlove():
    """Dinamički kreira sve potrebne foldere i fajlove za rad sistema ako ne postoje"""
    data_dir = os.path.join(os.path.dirname(__file__), 'data')
    os.makedirs(data_dir, exist_ok=True)
    
    inicijalni_fajlovi = {
        DATA_FILE: '{"devices":[], "pipes":[]}',
        NJIVE_FILE: '[]',
        OPSTINE_FILE: '[]',
        PODESAVANJA_FILE: '{}',
        ZONE_ZALIVANJA_FILE: '[]'
    }
    
    for putanja, podrazumevani_sadrzaj in inicijalni_fajlovi.items():
        if not os.path.exists(putanja):
            try:
                with open(putanja, 'w', encoding='utf-8') as f:
                    f.write(podrazumevani_sadrzaj)
                print(f"[BOOT] Kreiran fajl: {putanja}")
            except Exception as e:
                print(f"[BOOT GREŠKA] Neuspešno kreiranje fajla {putanja}: {e}")

def run_server():
    osiguraj_fajlove()
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, IrigacijaHandler)
    print("==========================================================")
    print(f" Standalone RPi Irigacija Web Server pokrenut!")
    print(f" Adresa: http://localhost:{PORT} (ili IP adresa vašeg RPi)")
    print(f" UDP Gateway aktivan na ruti: /api/udp-relay")
    print(f" Lokacija podataka: {DATA_FILE}")
    print("----------------------------------------------------------")
    print(" Pritisnite Ctrl+C za zaustavljanje servera.")
    print("==========================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Server zaustavljen.")
        sys.exit(0)

if __name__ == '__main__':
    run_server()
