/**
 * e621 pool downloader, converter and packager by Shelrock
 * @author: Angel garcía <git@angelgarcia.dev>
 */

// Imports.
import dotenv from 'dotenv'
import cp     from 'child_process' //!\\ Please, no jockes about this. //!\\
import fs     from 'fs'
import pptr   from 'puppeteer'
import path   from 'path'
import url    from 'url'
import qs     from 'querystring'

// `__dirname ` substitute
const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

// Environment variables.
dotenv.config({path: `${__dirname}/.env`})
const env  = process.env // Just an alias
const args = process.argv.slice(2) // CMD arguments.

// Configuration.
var config = {
  siteURL: env.E621_URL || 'https://e621.net',
  displayBrowser: env.DISPLAY_BROWSER == 'true',
  user: {
    usr: env.E621_USER,
    pwd: env.E621_PASS,
  },
  download: {
    dir:   env.E621_DIR   || process.cwd(),
    cache: env.E621_CACHE || __dirname + '/cache',
  },
  wait: {
    waitUntil: env.PPTR_WAIT_UNTIL || 'networkidle0',
    timeout:   parseInt(env.PPTR_WAIT_TIMEOUT || '5000'),
  },
}

// Package information
var pkg = JSON.parse(
  // await osProm.readFile(`${__dirname}/package.json`),
  await fs.readFileSync(`${__dirname}/package.json`)
)

// Super global for navigator.
var BROWSER

// Super global for downloader process (async)
var DL_QUEUE = []

/**
 * Generates a delay timeout.
 * 
 * @param {int} ms Time to be delayed.
 * @return {Promise} Promise will resolve in `ms` miliseconds.
 */
const sleep = (ms) => new Promise(solve => setTimeout(solve, ms))

/**
 * Perform a navigation and check if there is an antibot challenge. Retry if so.
 * 
 * @param  {pptr.page} page  - A pptr.page instance to be used for navigation.
 * @param  {string}    url   - URL to navigate.
 * @return {Promise(Buffer)} - Page content's buffer.
 */
function goto(page, url) {
  // Sync
  if(/\?/.test(url)) url += '&'
  else url += '?'
  
  return new Promise(async solve => {

    let version   = pkg.version
    let author    = pkg.author
    let toolName  = pkg.name
    let userAgent = await page.evaluate(() => navigator.userAgent)
  
    url += '_client=' +qs.escape(`${toolName}/${version} (${author}) ${userAgent}`)

    // Local result cache.
    let result = null

    // Navigation
    page.goto(url, config.wait)
    .then(async res => {
      // Test if there is a bot challengue
      let BotBTN = await page.$('[value="I am not a robot"]')
      if(null !== BotBTN) {
        // Send the anti-bot challengue
        await BotBTN.click()
        await page.waitForNavigation(config.wait)

        // Retry the navigation
        result = await goto(page, url)
        return
      }

      // Test if there is a +18 warning
      let WarnBTN = await page.$('#guest-warning-accept')
      if(null !== WarnBTN) await WarnBTN.click()
      
      // Fetch the page contents.
      result = await res.buffer()
      // solve(result)
    })
    .catch(async E => {
      result = await page.waitForNavigation(config.wait)
      .catch(async EE => {
        // Retry the navigation
        result = await goto(page, url)
      })
    })

    // Wait for the execution to end.
    let tle = config.wait.timeout * 8
    while(tle > 0) {
      if(null !== result) break 
      await sleep(100)
      tle -= 100
    }

    // If the results is still null, retry the navigation.
    if(null === result) result = await goto(page, url)

    await sleep(55000)
    solve(result)
  })
}

// const goto = async (page, url) => {
//   // Alias local.
//   let waiting = {
//     waitUntil: 'networkidle0',
//     timeout  : 5000,
//   }

//   return new Promise(async solve => {
//     let result = null

//     // Navegación.
//     page.goto(url, waiting)
//     .then(async res => {
//       // Si hay una prueba anti-bot.
//       let captcha = await page.$('[value="I am not a robot"]')
//       if (null !== captcha) {
//         // Envía el formulario anti-bot.
//         await captcha.click()
//         await page.waitForNavigation(waiting)

//         // Reintenta la navegación.
//         result = await goto(page, url)
//         return
//       }

//       // Test if there is a +18 warning
//       let WarnBTN = await page.$('#guest-warning-accept')
//       if(null !== WarnBTN) await warnBtn.click()

//       // Obtiene el contenido de la página.
//       result = await res.buffer()
//       solve(result)
//     })
//     .catch(async E => {
//       console.log("OWO!\n\n", E)
//       await sleep(10e5)
//       // Reintenta la navegación.
//       result = await goto(page, url)
//     })

//     // Espera a que termine la navegación.
//     let tle = waiting.timeout
//     while (tle > 0) {
//       if (null !== result) break
//       await sleep(100)
//       tle -= 100
//     }

//     // Si el resultado es null, reintenta la navegación.
//     if (null === result) {
//       result = await goto(page, url)
//     }

//     // Resuelve el resultado.
//     solve(result)
//   })
// }

/**
 * Launch a new tab. Preferred throug this function to perform tab setup to
 * comply with e6 bot directives.
 * 
 * @returns {pptr.page}
 */
async function Tab() {
  // Creates a new tab.
  let Tab = await BROWSER.newPage()

  // Tab setup.
  let version   = pkg.version
  let author    = pkg.author
  let toolName  = pkg.name
  let userAgent = await Tab.evaluate(() => navigator.userAgent)
  await Tab.setUserAgent(`${toolName}/${version} (${author}) ${userAgent}`)

  // Return the tab.
  return Tab
}

// /**
//  * Abre una nueva pestaña.
//  * @returns {pptr.Page} - Nueva pestaña.
//  */
// const Tab = async () => {
//   // Crea una nueva pestaña.
//   let page = await BROWSER.newPage()

//   // Configura la pestaña.
//   let version   = package.version
//   let author    = package.author
//   let toolName  = package.name
//   let userAgent = await page.evaluate(() => navigator.userAgent)
//   await page.setUserAgent(`${toolName}/${version} (${author}) ${userAgent}`)

//   // Devuelve la pestaña.
//   return page
// }

/**
 * Launch a new tab and close any other tabs.
 * 
 * @return {pptr.Page} - Newly opened tab.
 */
Tab.exclusive = async function TabEx() {
  // List tabs.
  let tabs = await BROWSER.pages()

  // Open the new page.
  let tab = Tab()

  // Close another tabs
  for(let old of tabs) old.close()

  return tab
}

/**
 * Login in e6
 */
function login() {
  console.log(`Performing login with user -- ${config.user.usr}`)

  // Async to do "fix" an unknown behavoir. Its a patch, not a real solution.
  return new Promise(async solve => {
    // Using an exclusive tab.
    let tab = await Tab.exclusive()
    
    await goto(tab, `${config.siteURL}/session/new`)
    
    // Login steps.
    try {
      await tab.type('input[name="name"]', config.user.usr)
      await tab.type('input[name="password"]', config.user.pwd)
      await tab.click('input[name="commit"]')

      // await timeout(10e6)

      await tab.waitForNavigation(config.wait)
      await timeout(1500)
    } catch(E) {
      // Try to check if the login was just failed or is the strange error.
      // If the user is already logged in, just let it be ~.^

      try {
        
        let roMSG = await tab.$('#notice span')
        if(null == roMSG) solve()
        
        if(0 < await tab.$eval('#notice span', 
        e => e.innerText.indexOf('logged in')
        )) solve()
        
        await goto(tab, `${config.siteURL}/`)
        let LoginLink = await tab.$('[title="Login or sign up"]')
        
        // If no login, do it again.
        if(null !== LoginLink) {
          await login()
          return
        }
      } catch(E) {
        await sleep(1800)
        try {
          await login()
          solve()
        } catch(E) {
          throw E 
        }
      }

      // solve()
    }

    // Check if the login was successfull.
    let Error = await tab.$('#notice span')
    if(null !== Error) {
      let msg = await tab.$eval('#notice span', e => e.innerText)
      if(msg.includes('incorrect')) {
        console.error('Error. User or password is wrong.')
        await BROWSER.close()
        process.exit(-1)
      }
    }
  })
}

// /**
//  * Inicia sessión en e621.
//  * @returns {null}
//  */
// async function login () {
//   // Log de inicio de sesión.
//   console.log(`Iniciando sesión en con ${config.user.usr}`)

//   // Abre una pestaña exclusiva.
//   let page = await Tab.exclusive()

//   // Navega al formulario de inicio de sesión.
//   await goto(page, `${config.siteURL}/session/new`)
//   console.log(`goto OK`)

//   // Comrueba si hay una notificación "+18"
//   let warnBtn = await page.$('#guest-warning-accept')
//   if (null !== warnBtn) await warnBtn.click()
//   console.log(`Warn OK`)

//   // Inicia sesión.
//   await page.type('input[name="name"]', config.user.usr)
//   await page.type('input[name="password"]', config.user.pwd)
//   await page.click('input[name="commit"]')
//   console.log(`Submit credentials OK`)
//   await page.waitForNavigation({waitUntil: 'networkidle0'})
//   console.log(`Login response OK`)

//   // Busca el mensaje de error.
//   let error = await page.$('#notice span')
//   if (null !== error) {
//     let message = await page.$eval('#notice span', e => e.innerText)
//     if (message.includes('incorrect')) {
//       console.error('Error: usuario o contraseña incorrectos.')
//       await BROWSER.close()
//       process.exit(1)
//     }
//   }
// }

/**
 * Finish the execution.
 * 
 * @param {int} code - Exit code.
 */
async function exit(code) {
  // Terminates the session.
  await goto(
    await Tab.exclusive(),
    `${config.siteURL}/session/sign_out`
  )

  // End the browser process.
  await BROWSER.close()

  // End the script execution.
  process.exit(code)
}

// /**
//  * Termina la ejecución.
//  * @param {int} code - Código de error.
//  */
// async function exit(code) {
//   // Cierra sesión (si la hubo).
//   if (config.user.usr && config.user.pwd) {
//     let page = await Tab.exclusive()
//     await goto(page, `${config.siteURL}/session/sign_out`)
//   }

//   // Cierra el navegador.
//   await BROWSER.close()

//   // Termina la ejecución.
//   process.exit(code)
// }

/**
 * Executes a system command. This is a workarround to use the `await` on such
 * call, cuz nodeJS do not do it on normal way.
 * 
 * @param  {String} cmd - The command to be executed.
 * @return {String}     - Command output.
 */
function osExec(cmd) {
  return new Promise(solve => {
    // Spawn child process.
    cp.exec(cmd, async (err, stdout, stderr) => {
      if(err) {
        console.error(err)
        await exit(-1)
      }

      // Return the exit
      solve(stdout)
    })
  })
}

// /**
//  * Ejecuta un comando. Hack para forzar a que el `await` funcione. (porque no lo hace)
//  * @param  {String} cmd - Comando a ejecutar.
//  * @return {String}     - Resultado del comando.
//  */
// function osExec(cmd) {
//   return new Promise(solve => {
//     exec(cmd, async (err, stdout, stderr) => {
//       if (err) {
//         console.error(err)
//         await exit(1)
//       }

//       solve(stdout)
//     })
//   })
// }

/**
 * Creates a promise that mark itself as destructable once it's fullfiled.
 * 
 * @param  {Promise} upstream - Original promise.
 * @return {Promise}          - @TODO
 */
function unstream(promise) {
  if(promise.isFulfilled) return promise // If already fulfilled, just return.
  
  // Mutable object
  let res = new (function UpstreamObject(){
    this.finished = () => !this.isPending
  })

  // Set initial state
  res.isPending   = true
  res.isRejected  = false
  res.isFulfilled = false

  promise.then(
    val => {
      res.isPending = false 
      res.isFulfilled = true 
      return val 
    },
    err => {
      res.isPending   = false 
      res.isRejected  = true 
      throw err 
    }
  )

  return res
}

/*******************************************************************************
 * Main function
 ******************************************************************************/
async function MAIN(){
  // Filter arguments. Only numeric values.
  let poolList = []
  for(let arg of args) {
    if(/^\d+$/.test(arg)) poolList.push(parseInt(arg))

    // If specify a download dir, use it.
    if('-d' == arg.substring(0, 2)) config.download.dir = arg.slice(2)
  }

  // Remove duplicated IDs and sort them ascending.
  poolList = [...new Set(poolList)].sort((a, b) => a - b)

  // If there is no IDs, finish excecution.
  if(0 == poolList.length) {
    console.log('Usage: node index.js pool_id [pool_id] [pool_id] ...')
    process.exit(0)
  }

  // If the download dir supplied is an empty string, finish execution
  if('' == config.download.dir) {
    console.log('Error: Download directory not supplied.')
    process.exit(0)
  }

  // Launch the navigator process
  BROWSER = await pptr.launch({
    headless: !config.displayBrowser,
  })

  // Login if user credentials is supplied.
  if(config.user.usr && config.user.pwd)
  await login()

  // Start fetching galleries metadata.
  console.log(`Fetching data of [[${poolList.length}]] pools...`)
  let usedTab = await Tab.exclusive()
  let poolsDetails = []
  for(let poolID of poolList){
    // Get the gallery buffer.
    let buffer        = await goto(usedTab, `${config.siteURL}/pools/${poolID}.json`)
    let bufferContent = await buffer.toString()
    let pool          = JSON.parse(bufferContent)

    // Skips if the gallery is unsuccessfull (explicity marked)
    if(false === pool.success) {
      console.log(`Pool ${poolID} skipping.`)
      continue
    }

    // Restore spaces in the pool name.
    pool.name = pool.name.replace(/_/g, ' ')
    console.log(`Downloading ${poolID}: ${pool.name}.`)
    poolsDetails.push(pool)

    let craftedUrl = `${config.siteURL}/posts.json?tags=pool:${poolID}&limit=30&page=`
    let page = 0
    while(pool.post_count > 30 * page) {
      page++
      let buffer = await goto(usedTab, craftedUrl + page)
      let posts  = JSON.parse(buffer).posts
      for(let post of posts) {
        DL_QUEUE.push({
          id:   post.id,
          file: post.file.url,
          ext:  post.file.ext,
        })
      }
    }

    usedTab = await Tab.exclusive()
  }

  // Remove duplicated and sort the results.
  DL_QUEUE = [...new Set(DL_QUEUE)].sort((a, b) => a.id - b.id)

  // Assure the existence of cache directory
  let cacheFiles = `${config.download.cache}/files`
  if(!fs.existsSync(config.download.cache)) fs.mkdirSync(config.download.cache)
  if(!fs.existsSync(cacheFiles)) fs.mkdirSync(cacheFiles)
  if(!fs.existsSync(`${cacheFiles}/raws`)) fs.mkdirSync(`${cacheFiles}/raws`)

  // Queue for async tasks.
  let TaskQueue  = []

  // Perform image downloading.
  let downloadCount = 0
  usedTab = await Tab.exclusive()
  for(let img of DL_QUEUE) {
    let cacheFile = `${cacheFiles}/${img.id}.webp`
    
    // Skip the download if there is a cached image.
    if(fs.existsSync(cacheFile)) continue

    // Perform the download
    downloadCount++
    TaskQueue.push(unstream(new Promise(async solve => {
      let rawFile = `${cacheFiles}/raws/${img.id}.${img.ext}`

      await sleep(downloadCount * 750) // do not start inmediatly.
      await osExec(`curl -Lso "${rawFile}" "${img.file}"`)
      
      // Exception for WEMB files.
      let awaiter = []

      if('webm' == img.ext) awaiter = [osExec(`mv "${rawFile}" "${cacheFile}"`)]
      else awaiter = [osExec(
              `cwebp -q 75 -m 6 -mt -o "${cacheFile}" "${rawFile}"`
        +`||gif2webp -q 75 -m 6 -mt -o "${cacheFile}" "${rawFile}"`
      )]

      Promise.all(awaiter).then(() => {
        downloadCount--
        solve()
      })
    })))
  }
  usedTab = await Tab.exclusive()

  while(0 < TaskQueue.length) {
    // console.log(`Waiging for ${TaskQueue.length} tasks to finish...`)
    process.stdout.write("\r" +`Waiging for ${TaskQueue.length} tasks to finish...`)
    TaskQueue = TaskQueue.filter(e => e.isPending)
    await sleep(1500)
  }
  console.log('')

  // Create the package
  for(let pool of poolsDetails){
    console.log(`(${pool.id.toString().padStart('6', '·')}) ${pool.name} ## ${pool.post_count}`)
    let poolArchive = pool.name
    .replaceAll(/[<>:"\\\/|?*\t]+/g, '_') // <>:"/\|?*(tab).
    .replaceAll(/^\.+/g, '') // Remove any heading dot.
    .replaceAll(/\.+$/g, '') // Temove any leading dot.
    let dir = `${config.download.dir}/${poolArchive}`

    // Async tasker.
    TaskQueue.push(unstream(new Promise(async solve => {
      // Create an empty destination directory
      if(fs.existsSync(dir)) await osExec(`rm -rf "${dir}"`)
      fs.mkdirSync(dir),
      fs.mkdirSync(`${dir}/pics`)

      // Copy each gallery image.
      let count = 0
      let container = []
      for(let id of pool.post_ids) {
        count++

        // Padded number for image name.
        let imgName = count.toString().padStart(8, '0')

        container.push(unstream(osExec(
          `cp "${cacheFiles}/${id}.webp" "${dir}/pics/${imgName}.webp"`
        )))
      }

      // Write the meta file
      container.push(unstream(new Promise(
        solve => fs.writeFile(
          `${dir}/meta.json`, 
          JSON.stringify(pool, null, 2),
          () => solve('OK')
        )
      )))

      // Await all copies to finish
      while(0 < container.length){
        await sleep(1500)
        container = container.filter(e => e.isPending)
      }

      // Creates teh zip file (finally)
      osExec(`7z a -tzip -sdel -mx=9 "${dir}.zip" "${dir}"`)
      .then(() => solve())
    })))
  }

  while(0 < TaskQueue.length) {
    // console.log(`Waiging for ${TaskQueue.length} tasks to finish...`)
    process.stdout.write("\r" +`Waiging for ${TaskQueue.length} tasks to finish...`)
    TaskQueue = TaskQueue.filter(e => e.isPending)
    await sleep(1500)
  }
  console.log('')

  console.log('Cleaning raw files...')
  TaskQueue.push(unstream(
    osExec(`rm -rf "${cacheFiles}/raws"`)
  ))

  while(0 < TaskQueue.length) {
    // console.log(`Waiging for ${TaskQueue.length} tasks to finish...`)
    process.stdout.write("\r" +`Waiging for ${TaskQueue.length} tasks to finish...`)
    TaskQueue = TaskQueue.filter(e => e.isPending)
    await sleep(1500)
  }
  console.log('')

  console.log('Done!')
  await exit(0)
}

(async function runScript(){
  try {await MAIN()} 
  catch(GLOBAL_E){
    console.log(`Catch all Exception!`, GLOBAL_E)
    exit(-99).catch(E => {})
  }
})()