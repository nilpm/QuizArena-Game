# Guía de contribución

¡Gracias por querer mejorar QuizArena! Esta guía explica cómo proponer cambios.

## Preparar el entorno

```bash
git clone https://github.com/<tu-usuario>/quizarena.git
cd quizarena
npm install
npm run dev
```

Necesitas Node.js 18 o superior. El servidor imprime en consola las URLs del juego y el PIN del anfitrión. Para probar sin celulares usa los comandos de consola (`bots 20`, `start`, `auto on`; escribe `help`).

## Flujo de trabajo

1. Abre un *issue* describiendo el error o la mejora (para cambios grandes, antes de programar).
2. Crea una rama desde `main`: `git checkout -b feat/mi-cambio` o `fix/mi-correccion`.
3. Haz cambios pequeños y enfocados, con tests cuando tenga sentido.
4. Ejecuta `npm test` y comprueba el juego a mano con bots.
5. Abre un *pull request* explicando **qué** cambia y **por qué**.

## Estilo

- JavaScript sin transpilar ni bundler; el cliente debe seguir funcionando sin dependencias externas ni internet.
- Respeta `.editorconfig` (UTF-8, 2 espacios, LF).
- Mensajes para el usuario en español (la interfaz actual lo está); comentarios y documentación pueden ir en español o inglés.
- Mantén el rendimiento en mente: el proyecto apunta a servidores muy pequeños (evita trabajo por mensaje y envíos de estado innecesarios).
- Mensajes de commit en imperativo y claros, preferiblemente con [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).

## Tests

```bash
npm test
```

Usamos el ejecutor integrado de Node (`node:test`), sin dependencias adicionales. Los tests viven en `test/`.

## Preguntas

Puedes aportar preguntas editando `data/questions.json` (formato en el [README](README.md#preguntas)). `npm test` valida que el archivo sea correcto.

## Reportar vulnerabilidades

No abras un issue público: sigue [SECURITY.md](SECURITY.md).
