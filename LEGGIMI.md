# Gommone

Strumenti di bordo per un Cape Horn Challenger 270 con Mercury 10 cv 4T.
Applicazione web installabile: gira nel browser del telefono, si aggiunge alla schermata
principale e continua a funzionare senza campo per le zone già visitate.

## Metterla online

Il GPS funziona solo su **https**, quindi il file non si può aprire con un doppio clic:
va pubblicato. Il modo più veloce è GitHub Pages, gratis e in cinque minuti.

1. Crea un repository su GitHub, per esempio `gommone`.
2. Carica il contenuto di questa cartella nella radice del repository.
3. Settings → Pages → Source: *Deploy from a branch*, branch `main`, cartella `/ (root)`.
4. Dopo un minuto l'indirizzo è `https://TUONOME.github.io/gommone/`.

In alternativa trascina la cartella su [netlify.com/drop](https://app.netlify.com/drop):
ti dà un indirizzo https immediato senza registrarti.

## Installarla sul telefono

- **iPhone**: apri l'indirizzo con Safari → Condividi → *Aggiungi a Home*.
  Poi vai in Impostazioni → Safari → Posizione e concedi l'accesso.
- **Android**: apri con Chrome → menù → *Installa app*.

Alla prima apertura concedi la posizione. Fai un giro con la rete attiva prima
dell'uscita: le mattonelle della mappa e la linea di costa restano in cache.

## Da dove arrivano i dati

| Cosa | Fonte | Note |
|---|---|---|
| Mappa | OpenStreetMap | tiles conservate in cache |
| Simbologia nautica | OpenSeaMap | livello opzionale |
| Linea di costa | OpenStreetMap via Overpass | scaricata una volta, poi in cache due mesi |
| Porti, scivoli, ormeggi | OpenStreetMap | raggio di 12 km |
| Meteo e vento | Open-Meteo | senza chiave, aggiornato ogni 20 minuti |
| Fondale | EMODnet | vedi sotto |

## Il fondale: leggi questa parte

Questa è l'unica voce della lista che non si può mantenere davvero.

**In mare** il servizio EMODnet restituisce una profondità interpolata da rilievi reali:
è utile come ordine di grandezza, non per passare vicino a una secca.

**Sui laghi italiani non esiste una fonte pubblica interrogabile punto per punto.**
Le carte batimetriche esistono (il CNR-IRSA e alcune Autorità di bacino le hanno
pubblicate) ma non come servizio web. Per questo l'app accetta un file:
in *Altro → Fondale* puoi caricare un GeoJSON con le isobate del tuo lago, e da
quel momento la profondità viene letta da lì. Serve che ogni elemento abbia una
proprietà numerica chiamata `depth`, `profondita`, `ele` o `z`.

Finché non lo carichi, sul lago il riquadro del fondale resterà vuoto. È corretto
che sia così: meglio un trattino che un numero inventato sotto la chiglia.

## La stima dei consumi

La curva litri/ora è ricostruita per un fuoribordo 10 cv quattro tempi su uno scafo
di 2,7 metri in acqua calma. **Non è una misura, è un modello.** Usalo per capire
se il carburante basta, non per arrivare col serbatoio a secco.

Per tararlo: fai il pieno, esci registrando il viaggio, rifai il pieno e confronta
i litri veri con quelli stimati. Se hai consumato il 20% in più, porta la
calibrazione a 1,20 in *Altro → Carburante e motore*.

Il modello tiene conto del carico: con tre persone lo scafo non plana e la velocità
massima realistica scende intorno agli 11 km/h.

## Limiti noti

- Le isolinee di distanza dalla costa si calcolano solo per specchi d'acqua chiusi
  mappati su OSM (laghi). In mare aperto la distanza dalla costa viene calcolata
  lo stesso, ma le isolinee possono comparire anche a terra.
- La velocità arriva dal GPS del telefono: sotto 1,5 km/h è rumore e viene azzerata.
- L'allarme di ancoraggio e quello di distanza funzionano solo con l'app in primo
  piano e lo schermo acceso.

Non è uno strumento di navigazione certificato. La responsabilità della condotta
resta di chi è al timone.
