# Watt · Calculadora del consum elèctric

Web autònoma en català, amb HTML, CSS i JavaScript modern sense frameworks, paquets, fonts externes, servidor propi ni claus d'API.

## Com utilitzar-la

Descomprimeix el ZIP i obre `index.html` amb el navegador. Cal connexió a Internet per consultar el PVPC. També es pot servir amb Live Server de VS Code o allotjar-la en qualsevol servidor estàtic (inclòs GitHub Pages). Si el navegador restringeix consultes des de `file://`, utilitza Live Server. No s'ha de fer `npm install` ni compilar.

1. Introdueix la potència en watts que consumeix l'aparell.
2. Veuràs els kWh consumits en una hora i els costos d'1, 8 i 24 hores, amb els imports sense impostos i finals estimats l'un al costat de l'altre.
3. Compara els tres períodes, consulta el gràfic i la taula d'hores, i revisa la disponibilitat dels pròxims cinc dies.
4. Per a un contracte de mercat lliure, selecciona «El meu contracte» i introdueix els tres preus en €/kWh sense impostos.

## Fitxers

- `index.html`: interfície accessible en català.
- `styles.css`: disseny adaptable, tema fosc i clar; sense recursos externs.
- `core.js`: càlculs, horaris, validació i adaptadors de les API.
- `app.js`: interfície, consultes i dades locals.

S'usen scripts clàssics amb `defer` perquè es pugui obrir el fitxer directament, sense les restriccions que tenen els ES Modules des de `file://`.

## Què es calcula

- Consum d'una hora: `watts / 1000` kWh.
- Cost d'una hora: `(watts / 1000) × preu en €/kWh`.
- Cost de 8 o 24 hores: `(watts / 1000) × hores × preu en €/kWh`. Es calcula amb els valors originals, abans d'arrodonir.
- Els costos de 8 i 24 hores del resultat principal mantenen el preu de la franja actual; els de les targetes mantenen la mitjana del període o el preu manual. Són estimacions a preu constant, no una suma dels preus futurs ni un ús que travessi diversos períodes.
- El resultat principal és una estimació d'una hora al preu de la franja actual. No integra els preus de les franges que travessaria un ús de 60 minuts començant en aquest instant.
- Es pressuposa potència constant; la potència de l'etiqueta pot ser un màxim i un aparell amb termòstat pot funcionar a intervals.
- El cost base és el terme d'energia sense impostos. Al costat es mostra el final estimat amb la proporció fiscal de la factura de referència i un repartiment opcional de costos fixos. Aquest repartiment és 0 €/dia per defecte.
- El PVPC no representa els preus de tots els contractes del mercat lliure.

## Fonts oficials i unitats

Font principal REData (Red Eléctrica):
`https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=AAAA-MM-DDT00:00&end_date=AAAA-MM-DDT23:59&time_trunc=hour`

S'utilitza exclusivament la sèrie PVPC, identificador 1001. Les dades d'€/MWh es divideixen per 1.000 per obtenir €/kWh. No s'utilitza el preu del mercat majorista com si fos el preu de consum.

Font alternativa oficial ESIOS:
`https://api.esios.ree.es/archives/70/download_json?date=AAAA-MM-DD`

S'utilitza el camp `PCB`, també en €/MWh. Ambdues fonts són públiques, no requereixen token i admetien CORS en la comprovació del 17 d'octubre de 2026. L'accés i els formats d'una API externa poden canviar.

La web torna a consultar els preus cada 15 minuts mentre està oberta, actualitza la franja horària i consulta el dia nou en passar la mitjanit. Cada font té un temps d'espera de 12 segons. El rellotge del dispositiu ha de ser correcte.

## Punta, pla i vall

Horari de la Península (Europe/Madrid):

- Punta: 10–14 h i 18–22 h de dilluns a divendres no festius aplicables.
- Pla: 8–10 h, 14–18 h i 22–24 h de dilluns a divendres no festius aplicables.
- Vall: 0–8 h, caps de setmana, 6 de gener i festius estatals fixos no substituïbles aplicables: 1 de gener, 1 de maig, 15 d'agost, 12 d'octubre, 1 de novembre, 6, 8 i 25 de desembre.

No s'hi inclouen automàticament els festius autonòmics, locals, substituïbles ni els sense data fixa. La llista de dates fixes és a `fixedHolidays` dins `core.js`; cal revisar-la si canvia la normativa. Font: Circular 3/2020, article 7.3, text consolidat: https://www.boe.es/buscar/act.php?id=BOE-A-2020-1066

En PVPC no hi ha tres imports fixos: les targetes mostren la mitjana aritmètica dels preus horaris d'un dia de referència. Si avui és laborable s'utilitza avui; si és tot vall, s'utilitza l'últim dia laborable per comparar els tres períodes amb dades del mateix dia, indicat a la pantalla. El preu actual i el gràfic sempre corresponen a avui. No es garanteix un ordre de preus entre els tres períodes.

Es validen 23, 24 o 25 hores segons el canvi d'hora. Es treballa amb instants absoluts i es mostra l'offset per diferenciar les hores repetides.

## Si falla la xarxa

Es prova REData i després ESIOS. Si fallen totes dues, es pot recuperar la còpia local del mateix dia amb un avís i l'hora en què es va consultar. Mai no es presenta el preu d'un altre dia com si fos el preu actual. Si no hi ha dades vàlides, s'indica que no estan disponibles. El mode de preus manuals continua funcionant.

Les preferències i les còpies dels preus es guarden a `localStorage` quan el navegador ho permet. No s'envien els watts ni els preus manuals a cap servidor. Les connexions a les API oficials transmeten les dades habituals de qualsevol connexió HTTP, com l'adreça IP.

## Validació

Proves amb Node.js, sense dependències: `node --test tests/core.test.cjs` (al repositori font). Inclouen conversions, períodes, festius, fus horari, canvis d'hora, dades incompletes i no vigents, preus zero/negatius i selecció de la franja actual.

S'ha comprovat la resposta real i la coincidència de les dues API oficials. La comprovació visual en navegador no estava disponible en l'entorn de creació.

## Els pròxims cinc dies

La taula comprèn demà i els quatre dies següents, amb les dates calculades en el fus Europe/Madrid. Es pot seleccionar el cost d'1, 8 o 24 hores.

El PVPC oficial es publica cada dia per al dia següent; no existeix una publicació oficial de cinc dies d'antelació. Font actual: https://www.ree.es/es/operacion/sistema-electrico/pvpc

Es consulta REData per a tot l'interval i ESIOS com a alternativa per a demà. Un dia només es considera publicat si es poden validar totes les seves 23, 24 o 25 hores. Cada període mostra la mitjana de les seves hores del mateix dia. No es reutilitza el preu d'avui ni de cap altre dia per emplenar un dia futur. Els dies sense publicació són «Pendent de publicació»; els errors de consulta o validació es distingeixen dels preus encara no publicats. Les còpies locals validades del dia exacte es marquen expressament.

En caps de setmana i festius aplicables, punta i pla indiquen «No s'aplica»; només vall pot tenir un preu. En mode «El meu contracte», es calculen els cinc dies amb els imports introduïts, suposant que es mantenen. Els costos de 8 i 24 hores mantenen el preu de referència de cada cel·la i no integren diferents franges.

La consulta es repeteix amb el botó «Actualitza» i cada 15 minuts mentre la pàgina està oberta.

## Cost final estimat a partir de la factura aportada

La imatge proporcionada mostra: energia 63,65 €, peatges 14,57 €, càrrecs 9,77 €, lloguer de comptador 0,91 € i impostos 23,15 €, amb un total de 112,05 €.

Per a una estimació fiscal es pren la proporció d'impostos respecte del subtotal sense impostos:

`subtotal = 112,05 − 23,15 = 88,90 €`

`impostos efectius = 23,15 / 88,90 = 26,0404949… %`

`factor = 112,05 / 88,90 = 1,260404949…`

`final estimat = cost base × factor + fix final diari atribuït × hores / 24`

El total i els impostos de la referència es poden modificar. No és un tipus impositiu legal ni s'infereixen l'IVA o l'impost elèctric de forma separada. És una aproximació proporcional: no es pot calcular amb precisió el tractament fiscal de cada concepte a partir d'un gràfic agregat. No es presenta com el total exacte de la factura ni com els impostos vigents per a tots els contractes. Es conserven tots els decimals fins a mostrar el resultat.

No es multiplica el PVPC per `112,05 / 63,65`, ja que el PVPC de l'API inclou el cost de producció, els peatges i els càrrecs variables. Afegir-los novament duplicaria conceptes. Font: https://www.ree.es/es/operacion/sistema-electrico/pvpc

El fix opcional s'introdueix en €/dia **amb impostos** i no s'hi tornen a aplicar impostos. La imatge no aporta els dies de facturació ni el detall del terme de potència, de manera que no permet obtenir aquest fix diari. El valor inicial és 0. L'usuari només n'ha d'introduir la part que vulgui atribuir a l'aparell; és un repartiment comptable de costos que poden existir encara que no consumeixi. No s'ha de sumar aquesta imputació una vegada per cada aparell si es vol reconstruir la factura sencera.

Totes les comparacions d'1, 8 i 24 hores, la taula de dies futurs i el detall horari mostren l'import base i el final estimat. Quan no hi ha preu publicat o la referència fiscal no és vàlida, no s'inventa un import final. Les dades de la factura de referència es desen només al navegador.
