/**
 * e621 pool downloader, converter and packager by Shelrock
 * @author: Angel garcía <git@angelgarcia.dev>
 */

// Constantes de importación.

const dotenv  = require('dotenv')
const exec    = require('child_process').exec
const fs      = require('fs')
const pptr    = require('puppeteer')
const package = require(`${__dirname}/package.json`)

// Carga de variables de entorno.
dotenv.config({path: `${__dirname}/.env`})
const env  = process.env // Alias de entorno.
const args = process.argv.slice(2) // Argumentos de la línea de comandos.

// Configuración.
var config = {
  siteURL: env.E621_URL || 'https://e621.net',
  // displayBrowser: env.DISPLAY_BROWSER == 'true',
  displayBrowser: true,
  user: {
    usr: env.E621_USER || '',
    pwd: env.E621_PASS || '',
  },
  download: {
    dir  : env.E621_DIR   || process.cwd(),
    cache: env.E621_CACHE || __dirname + '/cache',
  },
}

// Super global del navegador
var BROWSER

/*******************************************************************************
 * Funciones auxiliares
 ******************************************************************************/

/**
 * Genera un tiempo de espera.
 * @param {int} ms
 * @returns {Promise} - Resuelve una vez pasados `ms` milisegundos.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Realiza una navegación y comprueba si hay una prueba anti-bot. Reintenta si la hay.
 * @param   {pptr.page} page - Variable de la pestaña.
 * @param   {String}    url  - URL de navegación.
 * @returns {buffer}         - Buffer del contenido de la página.
 */
const goto = async (page, url) => {
  // Alias local.
  let waiting = {
    waitUntil: 'networkidle0',
    timeout  : 25000,
  }

  return new Promise(async solve => {
    let result = null

    // Navegación.
    page.goto(url, waiting)
    .then(async res => {
      // Si hay una prueba anti-bot.
      let captcha = await page.$('[value="I am not a robot"]')
      if (null !== captcha) {
        // Envía el formulario anti-bot.
        await captcha.click()
        await page.waitForNavigation(waiting)

        // Reintenta la navegación.
        result = await goto(page, url)
        return
      }

      // Obtiene el contenido de la página.
      result = await res.buffer()
      solve(result)
    })
    .catch(async err => {
      // Reintenta la navegación.
      result = await goto(page, url)
    })

    // Espera a que termine la navegación.
    let tle = waiting.timeout
    while (tle > 0) {
      if (null !== result) break
      await sleep(100)
      tle -= 100
    }

    // Si el resultado es null, reintenta la navegación.
    if (null === result) {
      result = await goto(page, url)
    }

    // Resuelve el resultado.
    solve(result)
  })
}

/**
 * Abre una nueva pestaña.
 * @returns {pptr.Page} - Nueva pestaña.
 */
const Tab = async () => {
  // Crea una nueva pestaña.
  let page = await BROWSER.newPage()

  // Configura la pestaña.
  let version   = package.version
  let author    = package.author
  let toolName  = package.name
  let userAgent = await page.evaluate(() => navigator.userAgent)
  await page.setUserAgent(`${toolName}/${version} (${author}) ${userAgent}`)

  // Devuelve la pestaña.
  return page
}

/**
 * Abre una pestaña y cierra las demás.
 * @returns {pptr.Page} - Nueva pestaña.
 */
Tab.exclusive = async () => {
  // Lista las pestañas.
  let tabs = await BROWSER.pages()

  // Abre una nueva pestaña.
  let page = Tab()

  // Cierra las demás pestañas.
  for (let tab of tabs) tab.close()

  // Devuelve la pestaña.
  return page
}

/**
 * Inicia sessión en e621.
 * @returns {null}
 */
async function login () {
  // Log de inicio de sesión.
  console.log(`Iniciando sesión en con ${config.user.usr}`)

  // Abre una pestaña exclusiva.
  let page = await Tab.exclusive()

  // Navega al formulario de inicio de sesión.
  await goto(page, `${config.siteURL}/session/new`)

  // Comrueba si hay una notificación "+18"
  let warnBtn = await page.$('#guest-warning-accept')
  if (null !== warnBtn) await warnBtn.click()

  // Inicia sesión.
  await page.type('input[name="name"]', config.user.usr)
  await page.type('input[name="password"]', config.user.pwd)
  await page.click('input[name="commit"]')
  await page.waitForNavigation({waitUntil: 'networkidle0'})

  // Busca el mensaje de error.
  let error = await page.$('#notice span')
  if (null !== error) {
    let message = await page.$eval('#notice span', e => e.innerText)
    if (message.includes('incorrect')) {
      console.error('Error: usuario o contraseña incorrectos.')
      await BROWSER.close()
      process.exit(1)
    }
  }
}

/**
 * Termina la ejecución.
 * @param {int} code - Código de error.
 */
async function exit (code) {
  // Cierra sesión (si la hubo).
  if (config.user.usr && config.user.pwd) {
    let page = await Tab.exclusive()
    await goto(page, `${config.siteURL}/session/sign_out`)
  }

  // Cierra el navegador.
  await BROWSER.close()

  // Termina la ejecución.
  process.exit(code)
}

/**
 * Ejecuta un comando. Hack para forzar a que el `await` funcione. (porque no lo hace)
 * @param  {String} cmd - Comando a ejecutar.
 * @return {String}     - Resultado del comando.
 */
function osExec(cmd) {
  return new Promise(solve => {
    exec(cmd, async (err, stdout, stderr) => {
      if (err) {
        console.error(err)
        await exit(1)
      }

      solve(stdout)
    })
  })
}

/*******************************************************************************
 * Función principal
 ******************************************************************************/
;(async function MAIN(){
  // Filtra los argumentos. Solo obtiene los IDs de las galerías.
  let poolList = []
  for (let arg of args) {
    if (/^\d+$/.test(arg)) poolList.push(parseInt(arg))

    // Si se especifica un directorio de descarga, se usa.
    if ('-d' == arg.substring(0, 2)) config.download.dir = arg.slice(2)
  }

  // Elimina los IDs duplicados y los ordena de menor a mayor.
  poolList = [...new Set(poolList)]
  poolList.sort((a, b) => a - b)

  // Si no hay ningún ID de galería, termina.
  if (0 == poolList.length) {
    process.stdout.write('Usage: node index.js [pool_id] [pool_id] ...\n')
    process.exit(0)
  }

  // Si se especifica un directorio de descarga vacío, termina.
  if ('' == config.download.dir) {
    process.stdout.write('Error: download directory is empty.\n')
    process.exit(1)
  }

  // Inicia el navegador.
  console.info('Iniciando navegador...')
  BROWSER = await pptr.launch({
    headless: !config.displayBrowser,
  })

  // Inicia sesión (si hay credenciales).
  if (config.user.usr && config.user.pwd) await login()

  // Obtiene los metadatos de las galerías.
  console.info(`Obteniendo metadatos de ${poolList.length} galerías...`)
  let imgDownload = []
  let poolsDetails = []
  for(let y = 0; y < poolList.length; y++) {
  // for (let poolID of poolList) {
    let poolID = poolList[y]
    // Obtiene los metadatos de la galería.
    let buffer = await goto(await Tab.exclusive(), `${config.siteURL}/pools/${poolID}.json`)
    let pool   = JSON.parse(buffer)

    if(false == pool.success) continue
    try {
      pool.name  = pool.name.replace(/_/g, ' ')
    } catch(E){
      console.info(pool)
      // await exit(0)
      continue
    }
    console.info(
      `[${y.toString().padStart(4, '_')}/${poolList.length.toString().padStart(4, '_')}]`
      +`(${pool.id}) ${pool.name}`
    )

    poolsDetails.push(pool)

    // Obtiene los metadatos de las imágenes.
    let craftedUrl = `${config.siteURL}/posts.json?tags=pool:${poolID}&limit=100&page=`
    let page = 0
    while (pool.post_count > 100 * page) {
      page++
      let buffer = await goto(await Tab(), craftedUrl + page)
      let posts  = JSON.parse(buffer).posts
      for (let post of posts) {
        imgDownload.push({
          id  : post.id,
          file: post.file.url,
          ext : post.file.ext,
        })
      }
    }
  }
  // Elimina los IDs duplicados y los ordena de mayor a menor.
  imgDownload = [...new Set(imgDownload)]
  imgDownload.sort((a, b) => b.id - a.id)

  // Se asegura que existe el directorio de descarga de temporales.
  let cacheFiles = `${config.download.cache}/files`
  if (!fs.existsSync(cacheFiles)) fs.mkdirSync(cacheFiles)
  if (!fs.existsSync(`${cacheFiles}/raws`)) fs.mkdirSync(`${cacheFiles}/raws`)

  // Descarga las imágenes.
  let counter = imgDownload.length
  for (let img of imgDownload) {
    let cacheFile = `${cacheFiles}/${img.id}.webp`
    let rawFile   = `${cacheFiles}/raws/${img.id}.${img.ext}`
    counter--

    // Si la imagen ya existe, no la descarga.
    if (fs.existsSync(cacheFile)) {
      console.info(`(${img.id}) ya descargada.`)
      continue
    }

    // Descarga la imagen.
    console.info(
      `[${counter.toString().padStart(7, '_')}]`+
      `(${img.id}) descargando...`
    )

    let cmd = `curl -Lso "${rawFile}" "${img.file}"`
    await osExec(cmd)

    // Convierte la imagen a WebP.
    console.info(`(${img.id}) convirtiendo a WebP...`)
    cmd = `cwebp -q 75 -m 6 -mt -o ${cacheFile} ${rawFile}`
    +`||gif2webp -q 75 -m 6 -mt -o ${cacheFile} ${rawFile}`

    // Excepción para webm
    if('webm' == img.ext) cmd = `mv ${rawFile} ${cacheFile}`
    await osExec(cmd)
  }

  for(let pool of poolsDetails) {
    console.info(`(${pool.id}) ${pool.name} (${pool.post_count} imágenes)`)
    console.info(`Generando archivo ZIP...`)

    // Variables para el nombre correcto del archivo. (simbolos no permitidos)
    let poolFilename = pool.name
    .replaceAll(/[<>:"\\\/|?*\t]+/gi, '_') // <>:"/\|?*\t
    .replace(/^\./g, '') // Elimina el primer punto.
    .replace(/\.$/g, '') // Elimina el último punto.
    let dir = `${config.download.dir}/${poolFilename}`

    // Crea el directorio de destino (debe estar vacío).
    if (fs.existsSync(dir)) await osExec(`rm -rf "${dir}"`)
    fs.mkdirSync(dir)
    fs.mkdirSync(`${dir}/pics`)

    // Copia las imágenes a la carpeta de destino. Se enumeran en orden en que aparecen
    // en la galería.
    let count = 0
    for (let id of pool.post_ids) {
      count++

      // Padder para el número de la imagen.
      let imgName = count.toString().padStart(8, '0')

      // Copia el archivo.
      try {
        fs.copyFileSync(
          `${cacheFiles}/${id}.webp`,
          `${dir}/pics/${imgName}.webp`
        )
      } catch(E) {}
    }

    // Escribe el archivo meta.json.
    let metaFile = `${dir}/meta.json`
    fs.writeFileSync(metaFile, JSON.stringify(pool, null, 2))

    // Genera el archivo ZIP. (compresion nivel 9)
    // Elimina el directorio al finalizar.
    if (fs.existsSync(`${dir}.zip`)) await osExec(`rm -f "${dir}.zip"`)
    await osExec(`7z a -tzip -sdel -mx=9 "${dir}.zip" "${dir}"`)
  }

  // Elimina los archivos temporales.
  console.info('Eliminando archivos temporales...')
  let cmd = `rm -rf ${cacheFiles}/raws`
  // await osExec(cmd)
  await exit(0)
})().catch(e => {
  console.error(`Error: ${e}`, e.stack)
  exit(1)
}).catch(() => {
  process.exit(1)
})
