# Executable Python wrapper

Aquest directori conté una versió empaquetable en Python del Gestor de Classes. 

## Requisits

* Python 3.10 o superior.
* [pip](https://pip.pypa.io/).

Instal·la les dependències amb:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Execució en mode desenvolupament

```bash
python main.py
```

La primera execució crearà un fitxer `gestor-classes-data.json` al mateix directori que l'executable i es farà servir per emmagatzemar les dades.

La interfície web es carrega directament des dels fitxers del projecte, de manera que no cal copiar-los manualment mentre es treballa en mode desenvolupament.

## Generar un executable

Abans d'empaquetar cal copiar els actius web a `python/assets` perquè PyInstaller els pugui incloure. Hi ha un script d'ajuda que deixa la carpeta preparada:

```bash
python prepare_assets.py
```

Un cop creats els actius, es pot utilitzar [PyInstaller](https://pyinstaller.org/) per crear un `.exe` o binari auto-contenidor:

```bash
pip install pyinstaller
pyinstaller --noconfirm --name gestor-classes \
  --add-data "assets:assets" main.py
```

> A Windows utilitza `--add-data "assets;assets"` (punt i coma en lloc de dos punts).

El fitxer resultant quedarà a `dist/gestor-classes/gestor-classes(.exe)` i utilitzarà `gestor-classes-data.json` al mateix directori per persistir la informació.
