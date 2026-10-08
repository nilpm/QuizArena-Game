# Changelog

Todos los cambios relevantes de este proyecto se documentan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [1.0.0] - 2026-10-08

### Añadido
- Primera versión pública: torneo de preguntas 1 contra 1 en tiempo real con Express y Socket.IO.
- Panel de anfitrión con PIN, configuración del torneo, llave, podio y editor de preguntas.
- Repechaje, semifinales, tercer puesto y final.
- Bots de prueba y piloto automático desde la consola.
- Documentación (README en español e inglés, `docs/ARCHITECTURE.md`), licencia MIT, guía de contribución y CI.
- Tests para la validación de preguntas y el servidor de estáticos.

### Cambiado
- Estructura del proyecto: código en `src/`, preguntas en `data/`, cliente en `public/`.
- La validación de preguntas se movió a `src/questions.js`.
- Si no se define `HOST_PIN`, se genera un PIN aleatorio en cada arranque (antes existía un PIN por defecto fijo) y se compara en tiempo constante.
- Nueva variable opcional `QUESTIONS_FILE` para elegir el banco de preguntas.

### Eliminado
- Dependencia `compression`, que no se usaba.
- Campo `main` que apuntaba a un archivo inexistente.
