# Diario de clase

Una aplicación web de código abierto diseñada para ayudar a los profesores a gestionar su día a día en el aula.

## Características

* **Gestión de Horarios**: Visualiza y gestiona tu horario semanal.
* **Anotaciones por Sesión**: Registra la planificación, el resumen y las anotaciones individuales de los estudiantes para cada clase.
* **Seguimiento del Alumnado**: Mantén un registro detallado de cada estudiante, incluyendo notas generales y un historial completo de anotaciones.
* **Multilingüe**: La interfaz está disponible en español, catalán, gallego, euskera e inglés.
* **Gestión de Datos Local**: Todos los datos se almacenan localmente en tu navegador, garantizando la privacidad.
* **Importación y Exportación**: Guarda y carga tus datos en formato JSON, permitiendo copias de seguridad y la transferencia entre dispositivos.

## Ejemplos integrados

Los archivos de traducción para el contenido de demostración se encuentran en el siguiente repositorio: [https://github.com/jjdeharo/gist/tree/main/diario/demo](https://github.com/jjdeharo/gist/tree/main/diario/demo)

## Empezando

1.  **Configuración Inicial**:
    * Ve a **Configuración** para definir las fechas del curso, las franjas horarias y crear tus clases y actividades.
    * Añade a tus estudiantes a cada clase, ya sea de forma individual o mediante la importación rápida.
2.  **Uso Diario**:
    * Utiliza la vista de **Horario** para acceder a los detalles de cada sesión.
    * Registra la planificación y el resumen de la clase.
    * Añade anotaciones específicas para cada estudiante.
3.  **Consulta de Datos**:
    * Accede a la ficha completa de cada estudiante desde la pestaña **Clases**.
    * Exporta la información de los estudiantes a formato DOCX.

## Tecnologías utilizadas

* HTML5
* CSS3 (con Tailwind CSS)
* JavaScript (Vainilla)

## Ejecutar en modo escritorio con Python

Si prefieres evitar el uso de un servidor local, puedes ejecutar la aplicación como un programa de escritorio usando [pywebview](https://pywebview.flowrl.com/):

1. Instala las dependencias de Python:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # En Windows: .venv\\Scripts\\activate
   pip install -r requirements.txt
   ```
2. Inicia la aplicación:
   ```bash
   python app.py
   ```

La interfaz se abrirá en una ventana nativa y los datos se guardarán automáticamente en el archivo `gestor-classes-data.json` ubicado junto al ejecutable o al script de Python.

### Crear un ejecutable independiente

Puedes empaquetar la aplicación como un ejecutable (por ejemplo, con [PyInstaller](https://pyinstaller.org/)):

```bash
pyinstaller --name gestor-classes --add-data "index.html:." --add-data "style.css:." \
  --add-data "main.js:." --add-data "state.js:." --add-data "actions.js:." \
  --add-data "views.js:." --add-data "i18n.js:." --add-data "manual_i18n.js:." \
  --add-data "utils.js:." --add-data "evaluation.js:." --add-data "filePersistence.js:." \
  --add-data "manual.html:." --add-data "logo.png:." --add-data "favicon.ico:." \
  --add-data "locales:locales" --noconfirm app.py
```

El ejecutable generado (en la carpeta `dist/gestor-classes`) seguirá guardando los datos en `gestor-classes-data.json` en la misma carpeta.

## Contribuciones

Este proyecto es mantenido por Àngel AC (aagust11@xtec.cat). Las contribuciones son bienvenidas.
