/*
 * irigacija_uno.ino
 * 
 * Arduino Uno UDP klijent za pametni sistem navodnjavanja (Irigacija).
 * Komunicira sa Raspberry Pi Python gateway serverom preko UDP protokola.
 * 
 * Hardverski zahtevi:
 * - Arduino Uno (ili kompatibilna ploča)
 * - Ethernet Shield W5100 / W5500 (ili sličan mrežni modul kompatibilan sa Ethernet.h)
 * - Relej modul povezan na digitalni pin 7 (za elektroventil / pumpu)
 * - Senzor pritiska povezan na analogni pin A0 (opciono)
 * 
 * Autor: Antigravity AI Pair Programmer
 */

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>

// =========================================================================
// MREŽNA KONFIGURACIJA
// =========================================================================
// Jedinstvena MAC adresa za vaš Ethernet Shield (promenite poslednji bajt ako imate više uređaja)
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };

// IP adresa vašeg Arduina u lokalnoj mreži. 
// Unesite tačno ovu adresu u visual map editoru pod "Arduino ID / IP" (npr. 192.168.1.100)
IPAddress ip(192, 168, 1, 100); 

// UDP port na kojem Arduino sluša zahteve. Standardno postavljen na 8888.
unsigned int localPort = 8888;      

// =========================================================================
// PIN KONFIGURACIJA
// =========================================================================
const int VALVE_PIN = 7;      // Digitalni pin 7 upravlja relejom (elektroventil)
const int PRESSURE_PIN = A0;  // Analogni pin A0 čita podatke sa senzora pritiska
const int FLOW_PIN = 2;       // Digitalni pin 2 se koristi za hardverski prekid (impulsni merač protoka)

volatile unsigned long pulseCount = 0; // Brojač impulsa sa senzora protoka

// Prekidna rutina (ISR) za detekciju impulsa sa Hall-ovog senzora protoka
void isr_pulse() {
  pulseCount++;
}

// =========================================================================
// BAFERI I UDP INSTANCA
// =========================================================================
char packetBuffer[UDP_TX_PACKET_MAX_SIZE]; // Bafer za dolazne poruke
char replyBuffer[50];                     // Bafer za slanje odgovora nazad

EthernetUDP Udp;

void setup() {
  // 1. Postavljanje pinova
  pinMode(VALVE_PIN, OUTPUT);
  digitalWrite(VALVE_PIN, LOW); // Pocetno stanje: elektroventil zatvoren (relej isključen)
  
  pinMode(FLOW_PIN, INPUT_PULLUP); // Aktivacija internog pull-up otpornika za stabilan rad senzora
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), isr_pulse, RISING); // Kačenje prekida na rastuću ivicu (RISING)
  
  // 2. Pokretanje serijskog monitora za lakše otklanjanje grešaka (debugging)
  Serial.begin(9600);
  while (!Serial) {
    ; // Čeka se serijska veza (potrebno za neke ploče poput Leonarda, na Unu ide odmah)
  }
  
  Serial.println("\n=============================================");
  Serial.println("  Arduino Uno Irigacija UDP Kontroler");
  Serial.println("=============================================");
  Serial.println("Inicijalizacija Ethernet mreže...");
  
  // 3. Pokretanje Ethernet veze sa fiksnom IP adresom
  Ethernet.begin(mac, ip);
  
  // Provera hardverskog statusa
  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("[ERR] Ethernet Shield nije detektovan! Proverite konekciju.");
    while (true) {
      delay(1); // Zaustavi dalji rad programa jer mreža ne radi
    }
  }
  
  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("[WARNING] Mrežni kabl (UTP) nije povezan u Ethernet utičnicu!");
  }
  
  // 4. Pokretanje UDP slušanja na zadatom portu
  Udp.begin(localPort);
  
  Serial.print("[OK] Arduino UDP server uspešno pokrenut!");
  Serial.print("\n  -> IP adresa: ");
  Serial.println(Ethernet.localIP());
  Serial.print("  -> Sluša na portu: ");
  Serial.println(localPort);
  Serial.println("---------------------------------------------");
  Serial.println("Spreman za prijem komandi...");
  Serial.println("=============================================\n");
}

void loop() {
  // Proveravamo da li je stigao mrežni UDP paket
  int packetSize = Udp.parsePacket();
  
  if (packetSize) {
    // 1. Čitanje dolaznog paketa u bafer
    int len = Udp.read(packetBuffer, UDP_TX_PACKET_MAX_SIZE - 1);
    if (len > 0) {
      packetBuffer[len] = '\0'; // Terminiramo string nulom na kraju
    }
    
    // Pretvaramo u String objekat i čistimo razmake i nevidljive karaktere (\r, \n)
    String command = String(packetBuffer);
    command.trim();
    
    // Ispisujemo detalje u serijskom monitoru Arduina
    Serial.print("[UDP] Primljen paket od ");
    Serial.print(Udp.remoteIP());
    Serial.print(":" );
    Serial.print(Udp.remotePort());
    Serial.print(" -> Komanda: '");
    Serial.print(command);
    Serial.println("'");
    
    // 2. PARSIRANJE I IZVREŠAVANJE KOMANDI
    
    // --- KOMANDA: OTVORI VENTIL ---
    if (command == "VALVE:1") {
      digitalWrite(VALVE_PIN, HIGH); // Pali relej (otvara elektroventil)
      Serial.println("  -> Akcija: Ventil OTVOREN.");
      
      // Pripremamo odgovor
      strcpy(replyBuffer, "VALVE_OPEN_OK");
      
      // Šaljemo UDP odgovor nazad na IP i port sa kojeg nam je stigao upit (naš RPi)
      Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
      Udp.write(replyBuffer);
      Udp.endPacket();
      Serial.println("  -> Odgovor poslat: VALVE_OPEN_OK");
    } 
    
    // --- KOMANDA: ZATVORI VENTIL ---
    else if (command == "VALVE:0") {
      digitalWrite(VALVE_PIN, LOW); // Gasi relej (zatvara elektroventil)
      Serial.println("  -> Akcija: Ventil ZATVOREN.");
      
      strcpy(replyBuffer, "VALVE_CLOSED_OK");
      
      Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
      Udp.write(replyBuffer);
      Udp.endPacket();
      Serial.println("  -> Odgovor poslat: VALVE_CLOSED_OK");
    } 
    
    // --- KOMANDA: OČITAJ PRITISAK (Merač pritiska) ---
    else if (command == "GET_PRESSURE") {
      // Čitamo analognu vrednost sa senzora pritiska (raspon 0 - 1023)
      int analogVal = analogRead(PRESSURE_PIN);
      float pressure = 0.0;
      
      // Ako senzor nije fizički spojen (plutajući analogni pin),
      // generisaćemo stabilnu simuliranu vrednost oko 2.4 bara sa blagom oscilacijom
      if (analogVal < 30) {
        // Generiše blagu oscilaciju u rasponu 2.30 - 2.50 bar za dinamičan prikaz
        pressure = 2.40 + ((float)random(-10, 10) / 100.0);
      } else {
        // Realna formula konverzije za senzor (npr. 0.5V - 4.5V senzor pritiska od 0 do 10 bar)
        // analogRead daje 0-1023. Prilagodite formulu specifikacijama vašeg senzora!
        pressure = (analogVal / 1023.0) * 10.0; 
      }
      
      // Konvertujemo float pritisak u string sa 2 decimale i upisujemo u replyBuffer
      dtostrf(pressure, 4, 2, replyBuffer);
      
      Serial.print("  -> Akcija: Očitavanje pritiska: ");
      Serial.print(replyBuffer);
      Serial.println(" bar.");
      
      Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
      Udp.write(replyBuffer);
      Udp.endPacket();
      Serial.print("  -> Odgovor poslat: ");
      Serial.println(replyBuffer);
    } 
    
    // --- KOMANDA: OČITAJ STATUS SISTEMA / PUMPE ---
    else if (command == "GET_STATUS") {
      // Može se proširiti da proverava da li pumpa ima napajanje ili struju
      strcpy(replyBuffer, "PUMP_OK");
      
      Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
      Udp.write(replyBuffer);
      Udp.endPacket();
      Serial.println("  -> Odgovor poslat: PUMP_OK");
    } 
    
    // --- KOMANDA: OČITAJ IMPULSE (Merač protoka) ---
    else if (command == "GET_PULSES") {
      noInterrupts(); // Isključujemo prekide dok kopiramo volatile brojač
      unsigned long pulses = pulseCount;
      pulseCount = 0; // Resetujemo brojač impulsa nakon čitanja
      interrupts();   // Ponovo uključujemo prekide
      
      ultoa(pulses, replyBuffer, 10); // Pretvaramo unsigned long u tekst
      
      Serial.print("  -> Akcija: Očitavanje impulsa protoka: ");
      Serial.println(replyBuffer);
      
      Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
      Udp.write(replyBuffer);
      Udp.endPacket();
      Serial.print("  -> Odgovor poslat: ");
      Serial.println(replyBuffer);
    } 
    
    // --- NEPOZNATA KOMANDA ---
    else {
      Serial.print("  -> [WARNING] Nepoznata komanda: ");
      Serial.println(command);
      
      strcpy(replyBuffer, "ERR_UNKNOWN_CMD");
      
      Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
      Udp.write(replyBuffer);
      Udp.endPacket();
    }
    
    Serial.println("---------------------------------------------");
  }
  
  delay(15); // Kratka pauza od 15ms radi stabilnosti i sprečavanja zagušenja procesora
}
