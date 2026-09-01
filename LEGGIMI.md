# Gommone sul Lario

Cape Horn Challenger 270, Mercury 10 cv 4T, Lago di Como, partenza da Mandello.
Applicazione web installabile: gira nel browser del telefono, si aggiunge alla
schermata principale e continua a funzionare senza campo nelle zone già viste.

## Metterla online

Il GPS funziona solo su **https**, quindi il doppio clic sul file non basta.

1. Crea un repository su GitHub, per esempio `lario`.
2. Carica il contenuto di questa cartella nella radice.
3. Settings → Pages → branch `main`, cartella `/ (root)`.
4. Dopo un minuto sei su `https://TUONOME.github.io/lario/`.

Più veloce ancora: trascina la cartella su app.netlify.com/drop e ti dà subito
un indirizzo https, senza registrarti.

## Installarla

- **iPhone**: apri con Safari → Condividi → *Aggiungi a Home*.
- **Android**: apri con Chrome → menù → *Installa app*.

Prima dell'uscita fai scorrere la mappa sulla zona dove andrai con la rete
attiva: le mattonelle e la linea di costa restano in memoria.

## Cosa arriva dalle carte del Lario

Dalle nove tavole del Consorzio dell'Adda ho ricavato:

- **41 approdi pubblici** con le coordinate stampate sulle tavole, da Como a
  Gera Lario passando per tutto il ramo di Lecco.
- **10 approdi di emergenza**, quelli con la E gialla.
- I **venti del lago** con i loro nomi: Tivano, Breva, Traversone, Bergamasca,
  Menaggino, Argegnino, Ventone, Breva dei Laghetti. L'app guarda direzione e
  ora e ti dice quale sta soffiando.
- Un **modello di profondità** costruito sull'asse profondo del lago, ricavato
  dagli scandagli delle tavole: 174 m davanti a Mandello, circa 180 m
  nell'Alto Lario, oltre 400 m fra Nesso e Argegno.

### Sulla profondità, per essere chiari

Le carte sono immagini, senza uno strato vettoriale: non si possono estrarre le
isobate una per una. Quello che c'è nell'app è una **stima**: prende la
profondità massima dell'asse del lago nel punto dove sei e la scala in base a
quanto sei lontano dalla riva, seguendo il profilo ripido tipico del Lario.

Al largo il numero è vicino al vero (a Mandello, mezzo chilometro dalla costa,
dà circa 126 m contro i 174 dell'asse; a settecento metri ne dà 157). **Vicino
a riva è volutamente prudente**, cioè sottostima: se dice tre metri potrebbero
essere cinque, ma non uno. Non è un ecoscandaglio e non lo sostituisce.

## La stima dei consumi

La curva litri/ora è ricostruita per un 10 cv quattro tempi su uno scafo di
2,7 m in acqua calma. È un modello, non una misura. Per tararlo: fai il pieno,
esci registrando il giro, rifai il pieno e confronta. Se hai bevuto il 20% in
più, porta la taratura a 1,20 nella scheda Barca.

Il carico conta: in due la velocità massima realistica scende sui 19 km/h, in
tre lo scafo non plana più e resti sugli 11.

## Le altre fonti

| Cosa | Da dove |
|---|---|
| Mappa | OpenStreetMap, resa grafica CARTO Voyager |
| Linea di costa e distanza dalla riva | OpenStreetMap via Overpass |
| Meteo e vento | Open-Meteo, senza chiave |

## Limiti noti

- Gli avvisi di distanza e la guardia all'ancora funzionano solo con l'app
  aperta e lo schermo acceso.
- La velocità viene dal GPS del telefono: sotto 1,5 km/h è rumore e va a zero.
- La pianificazione calcola la distanza in linea d'aria. Sul Lario è quasi
  sempre giusta perché il lago è dritto, ma fra Bellagio e i due rami conviene
  aggiungere un chilometro.

Non è uno strumento di navigazione certificato. Al timone ci sei tu.
