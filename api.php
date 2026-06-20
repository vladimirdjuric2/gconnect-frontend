<?php
/**
 * api.php - ZASTARELO (DEPRECATED).
 *
 * Zvanični backend sistema je Python server (server.py) koji opslužuje /api/* rute
 * i jedini implementira UDP gateway (/api/udp-relay) za komunikaciju sa hardverom.
 * Klijent (frontend) više ne gađa api.php — koristi isključivo /api/* rute.
 *
 * Ovaj fajl se zadržava samo radi kompatibilnosti sa eventualnim PHP-only hostingom
 * (učitavanje/čuvanje rasporeda u data/konfiguracija.json). NE dodavati nove funkcije ovde.
 */

header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? 'layout';
if ($action === 'njive') {
    $dataFile = __DIR__ . '/data/njive.json';
    $defaultContent = '[]';
} elseif ($action === 'opstine') {
    $dataFile = __DIR__ . '/data/opstine.json';
    $defaultContent = '[]';
} elseif ($action === 'podesavanja') {
    $dataFile = __DIR__ . '/data/podesavanja.json';
    $defaultContent = '{}';
} elseif ($action === 'zone-zalivanja') {
    $dataFile = __DIR__ . '/data/zone-zalivanja.json';
    $defaultContent = '[]';
} else {
    $dataFile = __DIR__ . '/data/konfiguracija.json';
    $defaultContent = '{"devices":[], "pipes":[]}';
}

// Osiguraj da data direktorijum postoji i da se svi folderi kreiraju
if (!is_dir(__DIR__ . '/data')) {
    mkdir(__DIR__ . '/data', 0755, true);
}

// Ako fajl potreban za rad korisnika ne postoji, dinamički ga kreiraj sa praznom strukturom
if (!file_exists($dataFile)) {
    file_put_contents($dataFile, $defaultContent);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $content = file_get_contents($dataFile);
    if ($content === false || trim($content) === '') {
        echo $defaultContent;
    } else {
        echo $content;
    }
} elseif ($method === 'POST') {
    $rawInput = file_get_contents('php://input');
    if (!$rawInput) {
        http_response_code(400);
        echo json_encode(["error" => "Nema ulaznih podataka"]);
        exit;
    }

    // Proveri da li je ispravan JSON
    $decoded = json_decode($rawInput, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        http_response_code(400);
        echo json_encode(["error" => "Neispravan JSON format: " . json_last_error_msg()]);
        exit;
    }

    // Upis u fajl na RPi disk
    $written = file_put_contents($dataFile, json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    if ($written !== false) {
        echo json_encode(["success" => true, "bytes" => $written]);
    } else {
        http_response_code(500);
        echo json_encode(["error" => "Neuspešno upisivanje konfiguracije u fajl."]);
    }
} else {
    http_response_code(405);
    echo json_encode(["error" => "Metod nije dozvoljen."]);
}
?>
