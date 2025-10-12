# Diario de clase

Una aplicación web de código abierto diseñada para ayudar a los profesores a gestionar su día a día en el aula.

## Características

* **Gestión de Horarios**: Visualiza y gestiona tu horario semanal.
* **Anotaciones por Sesión**: Registra la planificación, el resumen y las anotaciones individuales de los estudiantes para cada clase.
* **Seguimiento del Alumnado**: Mantén un registro detallado de cada estudiante, incluyendo notas generales y un historial completo de anotaciones.
* **Multilingüe**: La interfaz está disponible en español, catalán, gallego, euskera e inglés.
* **Persistencia Segura**: Los datos cifrados se almacenan en una base de datos MySQL mediante un servicio backend ligero.
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

## Backend de persistencia

La aplicación incluye un servicio Node.js sencillo para almacenar y recuperar el estado cifrado desde una base de datos MySQL.

1. Copia `server/.env.example` en `server/.env` y ajusta las credenciales si es necesario.
2. Instala las dependencias y arranca el servidor:

   ```bash
   cd server
   npm install
   npm start
   ```

El servicio expone los endpoints `GET /api/state` y `PUT /api/state` para recuperar y guardar el estado cifrado respectivamente. Si ejecutas el backend y el frontal en servidores distintos, configura el proxy o CORS según tus necesidades.

## Tecnologías utilizadas

* HTML5
* CSS3 (con Tailwind CSS)
* JavaScript (Vainilla)

## Contribuciones

Este proyecto es mantenido por Àngel AC (aagust11@xtec.cat). Las contribuciones son bienvenidas.
