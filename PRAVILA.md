# Pravila Razvoja i Arhitekture Sistema

Ovaj dokument sadrži obavezujuća pravila i standarde kojih se moraju pridržavati svi kôd moduli (PHP, Python, JavaScript) i AI asistenti u okviru ovog projekta.

---

## 1. Jezik komunikacije sa korisnikom
* **Pravilo:** Sva komunikacija sa korisnikom od strane AI asistenta (odgovori, objašnjenja, predlozi, planovi i walkthrough izveštaji) mora se odvijati **isključivo na srpskom jeziku**.

---

## 2. Zabrana hardkodovanja korisničkih podataka
* **Pravilo:** Nijedan podatak koji je specifičan za korisnika ili njegov rad (npr. nazivi katastarskih opština, nazivi njiva, parcele, brojevi parcela, koordinate, boje, nazivi sistema i slično) **ne sme** biti hardkodovan u kôdu kao podrazumevani niz ili vrednost.
* **Implementacija:**
  * Svi podaci se učitavaju isključivo dinamički sa servera/baze.
  * Ukoliko nema podataka na serveru, klijentski kôd inicijalizuje prazno stanje (`[]` ili `null`) i omogućava korisniku da kroz korisnički interfejs unese sopstvene podatke.
  * U kôdu ne smeju postojati lokalni fallback nizovi sa predefinisanim geografskim lokacijama ili nazivima mesta.

---

## 3. Dinamičko kreiranje foldera i fajlova za rad
* **Pravilo:** Svi folderi i fajlovi koji su neophodni za normalan rad korisnika i skladištenje podataka moraju biti kreirani **potpuno automatski i dinamički**.
* **Implementacija:**
  * Prilikom pokretanja servera (boot) ili na prvi klijentski API zahtev, sistem proverava postojanje direktorijuma za podatke (npr. `data/`) i potrebnih JSON baza (`konfiguracija.json`, `njive.json`, `opstine.json`, `podesavanja.json`).
  * Ukoliko direktorijum ili fajlovi ne postoje na disku, server ih **odmah automatski kreira** i upisuje u njih inicijalnu, praznu JSON strukturu (npr. `[]` za nizove, `{}` za podešavanja ili `{"devices":[], "pipes":[]}` za objekte).
  * Korisnik nikada ne sme imati obavezu ručnog kreiranja struktura na disku, niti sistem sme da baci grešku ili ne radi ako se fajlovi obrišu.

---

## 4. Efikasno čitanje fajlova od strane AI asistenta
* **Pravilo:** Najstrože je zabranjeno uzastopno čitanje istog fajla u malim fragmentima (chunk-ovima) više puta zaredom. AI asistent mora pročitati fajl **CELOG odjednom** i držati ga u memoriji (svom radnom kontekstu) tokom analize i modifikacije.
* **Implementacija:**
  * Kada AI asistent pristupi fajlu koji treba analizirati ili menjati, učitava ga u celosti (ukoliko veličina fajla to dozvoljava).
  * Sve analize, provere i planiranje izmena vrše se nad tom celovitom memorisanom verzijom u kontekstu, bez ponovnog pozivanja alata `view_file` za isti fajl u kratkom vremenskom roku.


