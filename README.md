# Gestor de classes

Aplicació web en català per organitzar totes les tasques relacionades amb les assignatures d'un docent. Funciona completament al navegador i desa automàticament la informació a l'emmagatzematge local.

## Funcionalitats principals

* **Gestió d'assignatures**: crea tantes assignatures com calgui i defineix les seves dates d'inici i fi, els dies de classe i els períodes d'avaluació.
* **Compartició de configuracions**: vincula assignatures perquè comparteixin automàticament competències, criteris, activitats i dies festius.
* **Competències i criteris**: defineix competències específiques i ordena-les lliurement. Cada criteri rep un identificador automàtic del tipus `CA`. La configuració permet personalitzar el text que acompanya els codis `CE` i `CA`.
* **Activitats avaluables**: crea activitats i assigna-hi criteris amb pesos numèrics per preparar rúbriques de qualificació.
* **Alumnat**: registra l'alumnat i assigna'l a les diferents assignatures. Cada alumne pot tenir observacions generals.
* **Assistència i seguiment**: registra assistència, retards, actitud i comentaris per sessió i alumne.
* **Avaluació flexible**: avalua per criteris amb una graella interactiva. Es pot treballar amb notes numèriques o bé amb escales qualitatives personalitzables.
* **Dies festius**: marca els dies sense classe per cada assignatura o conjunt d'assignatures vinculades.
* **Desament automàtic**: qualsevol canvi es guarda automàticament sense necessitat d'exportar fitxers.

## Funcionament

L'aplicació no necessita cap servidor. Només cal obrir `index.html` amb un navegador modern. Les dades es desen a l'emmagatzematge local del navegador, de manera que cadascú disposa de les seves pròpies configuracions i registres.

Per fer còpies de seguretat n'hi ha prou amb exportar el contingut de `localStorage` o utilitzar eines del navegador. També es pot clonar el repositori per adaptar la interfície o el flux de treball a necessitats específiques.

## Llicència

Codi alliberat sota llicència Creative Commons BY-SA.
