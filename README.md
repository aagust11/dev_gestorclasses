# Diario de clase

Una aplicación web de código abierto diseñada para ayudar a los profesores a gestionar su día a día en el aula.

## Características

* **Gestión de Horarios**: Visualiza y gestiona tu horario semanal.
* **Anotaciones por Sesión**: Registra la planificación, el resumen y las anotaciones individuales de los estudiantes para cada clase.
* **Seguimiento del Alumnado**: Mantén un registro detallado de cada estudiante, incluyendo notas generales y un historial completo de anotaciones.
* **Multilingüe**: La interfaz está disponible en español, catalán, gallego, euskera e inglés.
* **Gestión de Datos**: Puedes almacenar la información localmente en el navegador o sincronizarla con una base de datos MySQL mediante la API incluida.
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

## Persistencia de datos

La aplicación soporta dos modos de guardado:

* **Archivo local**: es el comportamiento por defecto. La información se guarda en un JSON dentro del propio equipo utilizando la File System Access API. Esta opción requiere conceder permisos al navegador.
* **Base de datos**: permite leer y escribir el mismo JSON en una tabla MySQL mediante peticiones HTTP.

Desde **Configuración → Datos** puedes elegir el modo de persistencia, comprobar el estado y forzar la sincronización.

### Servidor API

En el repositorio se incluye un backend mínimo (`server.js`) que expone tres endpoints REST (`/status`, `/data` GET y `/data` POST). Para ponerlo en marcha:

1. Crea un archivo `.env` a partir de `.env.example` con las credenciales de tu servidor MySQL. Por defecto se utilizará la tabla `data` con un único registro (`id = 1`).
2. Instala las dependencias: `npm install`.
3. Arranca el servicio: `npm run start` (o `npm run dev` para desarrollo con recarga).

Configura `API_ALLOWED_ORIGINS` para restringir el acceso CORS y, si lo necesitas, define `API_TOKEN` para exigir un token Bearer en cada petición.

El cliente web almacena la URL base y el token (si existe) en `localStorage`. Si la API devuelve un error o el permiso se deniega, podrás volver a solicitar la conexión desde la propia interfaz.

## Tecnologías utilizadas

* HTML5
* CSS3 (con Tailwind CSS)
* JavaScript (Vainilla)

## Contribuciones

Este proyecto es mantenido por Àngel AC (aagust11@xtec.cat). Las contribuciones son bienvenidas.
