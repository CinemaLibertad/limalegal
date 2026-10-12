# Lima Legal — contexto de continuidad

Este documento resume el contexto para iniciar un chat separado dedicado exclusivamente a Lima Legal. Es una nota de traspaso; no autoriza por sí sola despliegues, publicaciones ni operaciones Git.

## Objetivo

Construir **Lima Legal**, una plataforma SaaS jurídica independiente. El sistema de Bernabé queda pausado y no debe mezclarse con este proyecto ni reutilizar su Firebase, datos privados, dominio, secretos o identidad visual.

La copia web existente se transformará en la plataforma independiente: se reemplazará la landing institucional por un onboarding de Lima Legal y se eliminarán referencias, identidad y datos específicos de Bernabé. Primero se construirá el producto funcional completo; planes, límites comerciales y suscripciones se definirán más adelante.

## Proyectos y ubicaciones

- Web Next.js: `C:\Users\Sebastian\Documents\ChatGPT\Lima Legal next-app`
- Repositorio GitHub previsto: `https://github.com/CinemaLibertad/limalegal/tree/main`
- App Android independiente: `C:\Users\Sebastian\Documents\ChatGPT\Lima Legal App`
- Nombre Firebase: `Lima Legal`
- Firebase project ID: `lima-legal`
- Número de proyecto: `85336537304`

La web y Android tienen aplicaciones registradas dentro del mismo proyecto Firebase de Lima Legal. La app Android se llama **Lima App**, usa el paquete `com.nativa.limalegal` y su app ID es `1:85336537304:android:d1d07eb8be644dbd9a3fad`. La app web registrada se llama **Lima Legal**; su app ID es `1:85336537304:web:b93b09272ba3980f9a3fad`.

La configuración SDK web fue proporcionada por el usuario en el chat anterior. Es configuración pública del cliente; los secretos backend deberán permanecer en Secret Manager y no en el bundle ni en el repositorio.

## Android y vinculación

Android será una aplicación compañera, con identidad Lima Legal, sin referencias al estudio de Bernabé. Se vinculará con el espacio de trabajo desde la web mediante un código QR y los datos de activación correspondientes. Ambas apps consumirán el mismo backend y los mismos contratos; no crear bases paralelas.

La app Android está en un proyecto Android Studio inicialmente en blanco. El usuario indicó que el icono y el logo PNG de Lima Legal están en `drawable`; se pueden trasladar a la web cuando estén disponibles allí. No asumir que el nombre del proyecto Android determina la marca final sin confirmación adicional.

## Estado local observado al preparar este traspaso

- La carpeta web contiene la copia de la aplicación de Bernabé y los módulos Next.js existentes.
- El `origin` local todavía apunta a `https://github.com/CinemaLibertad/bernabe.git`, no al repositorio `limalegal`.
- La rama local observada es `main`, sincronizada con su remoto actual y sin cambios previos sin confirmar.
- No se cambió el remoto, no se hizo commit ni push, y no se desplegó la aplicación.
- La copia todavía contiene referencias a Bernabé y configuración Firebase anterior. No conectar ni desplegar esta copia hasta completar la separación y apuntar al proyecto `lima-legal`.
- El usuario está creando/ha creado el repositorio `CinemaLibertad/limalegal`; verificar su estado al continuar. No hacer operaciones Git hasta recibir una instrucción explícita.

## Criterios de trabajo

- Mantener módulos separados y responsabilidades claras; no convertir `index`/la página de entrada en un contenedor monolítico.
- No incluir datos ficticios como si fueran registros reales.
- Mantener identidad y configuración de Lima Legal separadas de Bernabé desde el cliente hasta Firestore, Functions y reglas.
- Antes de diseñar multiusuario, definir aislamiento por espacio de trabajo y usuario, relaciones, permisos y contratos compartidos. No copiar datos privados del estudio de Bernabé.
- El flujo de activación móvil por QR será una asociación autenticada y revocable; no tratar un QR estático como credencial permanente.
- No afirmar que un servicio, integración o entrega push funciona hasta que exista e integre realmente.

## Instrucciones operativas del usuario

- Actuar únicamente sobre lo pedido explícitamente; ante duda, hacer menos.
- No compilar, probar, ejecutar, instalar herramientas o dependencias salvo petición explícita.
- No hacer commit, push, pull, merge, rebase, reset ni cambiar remotos/ramas sin instrucción explícita.
- No desplegar ni publicar el sitio ni modificar recursos externos sin instrucción explícita.
- No hacer refactors generales ni cambios no necesarios.
- Mantener las respuestas concisas.

## Primer paso sugerido para el chat nuevo

Leer este documento y las instrucciones del repositorio. Inspeccionar de forma acotada el estado del repo `limalegal`, el proyecto web y el Android en sus carpetas respectivas; presentar el plan de separación/migración de identidad y configuración antes de modificar archivos. No publicar ni conectar el proyecto a hosting.
