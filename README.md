# 🏆 QuizArena

[![CI](https://github.com/<tu-usuario>/quizarena/actions/workflows/ci.yml/badge.svg)](https://github.com/<tu-usuario>/quizarena/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)

**Torneo de preguntas en tiempo real, en formato de eliminatoria.** Un anfitrión proyecta su pantalla, los jugadores entran escaneando un código QR desde el celular y se enfrentan en combates 1 contra 1 hasta que queda un campeón.

🇬🇧 [Read this in English](README.en.md)

---

## Características

- 🎮 **Sin instalación para los jugadores**: se unen desde el navegador del celular con un QR; eligen nombre, figura y color.
- 🥊 **Eliminatoria automática**: rondas 1 contra 1, repechaje para quienes pierden la primera ronda, semifinales, tercer puesto y final.
- ⚡ **Tiempo real** con [Socket.IO](https://socket.io/): puntaje, llaves y reconexiones al instante.
- 🖥️ **Panel de anfitrión** protegido con PIN: configuración del torneo, editor de preguntas, llave del torneo y podio.
- 🔌 **Tolerante a fallos**: si un jugador pierde la conexión tiene 20 s para volver antes de perder por W.O.
- 🪶 **Muy liviano**: pensado para servidores con ~0.1 CPU / 512 MB (archivos precomprimidos en memoria, sin compresión por mensaje).
- 🤖 **Bots y piloto automático** para probar el torneo completo sin necesitar decenas de celulares.
- 🌐 **Sin dependencias de internet en el cliente**: iconos propios en SVG, sin CDN ni librerías externas.

## Inicio rápido

Requisitos: [Node.js](https://nodejs.org/) 18 o superior.

```bash
git clone https://github.com/nilpm/quizarena.git
cd quizarena
npm install
npm start
```

Al arrancar verás en consola algo como:

```
Jugadores (QR):  http://192.168.1.20:3000
Anfitrión:        http://192.168.1.20:3000/host.html
PIN del anfitrión:  4821   (aleatorio; fíjalo con la variable HOST_PIN)
```

1. Abre la URL del **anfitrión** en el equipo conectado al proyector e ingresa el PIN.
2. Los jugadores escanean el **QR** (o abren la URL de jugadores) estando en la misma red.
3. Cuando todos estén en el lobby, pulsa **Iniciar torneo**.

> Para jugar con gente fuera de tu red local, despliega el servidor en un hosting con Node.js y define `PUBLIC_URL` (ver [Configuración](#configuración)).

### Probarlo sin celulares

En la consola donde corre el servidor puedes escribir comandos de prueba:

```text
bots 30            # agrega 30 jugadores falsos al lobby
cfg battleSec=15   # combates más cortos
start              # inicia el torneo
auto on            # el anfitrión se maneja solo hasta el final
```

Consulta la lista completa con `help`. Con `FAST=1 npm start` todos los tiempos del juego se aceleran 10 veces.

## Cómo se juega

| Fase | Qué ocurre |
| --- | --- |
| **Lobby** | Los jugadores se unen y personalizan su avatar. El anfitrión ajusta la configuración. |
| **Ronda 1** | Emparejamientos al azar. Cada jugador responde en su celular durante `battleSec` segundos. Quien pierde pasa al repechaje. |
| **Repechaje** | Los perdedores de la ronda 1 se enfrentan; el ganador vuelve al torneo, el perdedor queda eliminado. |
| **Rondas 2…n** | Quien pierde queda eliminado. Con número impar de jugadores uno descansa (*bye*) y avanza solo. |
| **Semifinales / 3er puesto / Final** | Cuando quedan 4 o menos, los combates se juegan **en la pantalla del anfitrión** y los jugadores responden con un mando (A/B/C/D). |
| **Podio** | Se muestran los 3 primeros puestos y los premios configurados. |

**Puntaje**: 100 puntos por respuesta correcta + 50 extra para el primero en acertar cada pregunta.
**Empates**: gana quien sumó puntos primero; si nadie sumó, se decide al azar.
**Tiempo global**: si se agota el tiempo total del torneo, al terminar la fase en curso se clasifica a todos por puntos acumulados.

## Configuración

### Variables de entorno

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP. |
| `HOST_PIN` | aleatorio por arranque | PIN para entrar a `/host.html`. Defínelo siempre en producción. Vacío (`HOST_PIN=`) desactiva la protección. |
| `PUBLIC_URL` | `http://<IP-local>:<PORT>` | URL que se codifica en el QR. Obligatoria detrás de un proxy o en un hosting. |
| `QUESTIONS_FILE` | `data/questions.json` | Ruta del banco de preguntas. |
| `FAST` | – | Si está definida, acelera los tiempos ×10 (solo para pruebas). |

Hay un ejemplo en [`.env.example`](.env.example). Con Node ≥ 20.6 puedes cargarlo con:

```bash
node --env-file=.env src/server.js
```

### Opciones del torneo (panel del anfitrión)

| Opción | Por defecto | Rango | Descripción |
| --- | --- | --- | --- |
| `totalMin` | 40 | 1–240 | Duración total del torneo (minutos). |
| `battleSec` | 60 | 10–600 | Duración de cada combate normal (segundos). |
| `qCount` | 5 | 1–20 | Preguntas por combate. |
| `topQSec` | 15 | 5–60 | Tiempo por pregunta en semifinales y final (segundos). |
| `prizes` | – | – | Premio de 1.º, 2.º y 3.º lugar (texto libre). |

## Preguntas

Las preguntas viven en [`data/questions.json`](data/questions.json) y se pueden editar desde el botón **Preguntas** del panel del anfitrión (se validan antes de guardarse).

```json
{
  "ronda1": [
    { "q": "¿Cuál es la capital de Francia?", "o": ["Madrid", "París", "Roma", "Berlín"], "a": 1 }
  ],
  "final": [ ... ],
  "otras": [ ... ]
}
```

- `q`: texto de la pregunta.
- `o`: de 2 a 4 opciones.
- `a`: índice (empezando en 0) de la opción correcta.

Cada fase toma preguntas de su propia clave: `repechaje`, `ronda1`, `ronda2`, … `ronda10`, y `final` (semifinales, tercer puesto y final). Si una clave tiene menos preguntas de las necesarias se completa con `otras`; las opciones se barajan para cada jugador.

## Despliegue

Cualquier plataforma que ejecute Node.js sirve (Render, Railway, Fly.io, un VPS…). Lo esencial:

- Comando de inicio: `npm start`
- Variables: `HOST_PIN` y `PUBLIC_URL` (la URL pública con `https://`).
- Debe haber **una sola instancia**: el estado del torneo vive en memoria.
- Soporte de WebSockets habilitado (casi todas las plataformas lo tienen por defecto).

## Estructura del proyecto

```text
quizarena/
├── src/
│   ├── server.js        # Servidor Express + Socket.IO y lógica del torneo
│   ├── questions.js     # Validación del banco de preguntas
│   └── fast-static.js   # Servidor de estáticos precomprimidos en memoria
├── public/              # Cliente (jugador: index.html, anfitrión: host.html)
├── data/questions.json  # Banco de preguntas
├── test/                # Tests (node:test, sin dependencias extra)
└── docs/ARCHITECTURE.md # Diseño interno y protocolo de eventos
```

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desarrollo

```bash
npm run dev    # reinicia el servidor al cambiar archivos
npm test       # ejecuta los tests
```

Las contribuciones son bienvenidas: revisa [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitaciones conocidas

- Solo hay un torneo a la vez y su estado se guarda en memoria (si el servidor se reinicia, se pierde).
- El PIN protege el panel del anfitrión, pero no sustituye a HTTPS: en internet público usa siempre `https://`.
- La interfaz está en español.

## Créditos

- Sonido de clic: `public/buttonClickSong_V1.mp3`. Confirma que tienes derecho a redistribuirlo antes de publicar el repositorio (si no, reemplázalo por uno propio o de licencia libre).
- Construido con [Express](https://expressjs.com/), [Socket.IO](https://socket.io/) y [qrcode](https://github.com/soldair/node-qrcode).

## Licencia

[MIT](LICENSE) © 2026 nilpm
