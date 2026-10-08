# Política de seguridad

## Reportar una vulnerabilidad

Si encuentras un problema de seguridad, **no abras un issue público**. Usa la opción *Report a vulnerability* de la pestaña **Security** del repositorio en GitHub (reporte privado) y describe el problema con los pasos para reproducirlo.

Intentaremos responder en un plazo razonable y publicar una corrección antes de divulgar los detalles.

## Recomendaciones al desplegar

- Define siempre `HOST_PIN` con un valor no trivial.
- Publica el servicio detrás de **HTTPS**; el PIN viaja por Socket.IO.
- Ejecuta una sola instancia y no expongas la consola del proceso (los comandos de prueba `bots`, `start`, `auto`… se leen de la entrada estándar).
