import { getInput, setFailed, setOutput, summary } from '@actions/core'
import Cloudflare from 'cloudflare'
import { execa } from 'execa'

/**
 *
 * @param {Cloudflare} cf
 * @param {string} name
 * @param {string} cid
 * @param {string} zoneId
 */
async function createRecord(cf, name, cid, zoneId) {
  const result = await cf.dns.records.create({
    content: `dnslink=/ipfs/${cid}`,
    type: 'TXT',
    name,
    path_zone_id: zoneId,
  })

  return result
}

/**
 *
 * @param {Cloudflare} cf
 * @param {string} name
 * @param {string} cid
 * @param {string} zoneId
 */
async function upsertRecord(cf, name, cid, zoneId) {
  const records = await cf.dns.records.list({
    zone_id: zoneId,
    type: 'TXT',
    name,
  })

  if (records.result.length > 0) {
    const found = records.result.find((record) =>
      /** @type {string} */ (record.content).startsWith('dnslink=/ipfs/')
    )
    if (found?.id) {
      const content = `dnslink=/ipfs/${cid}`

      // Skip if record already exists
      if (found.content === content) {
        return
      }

      await cf.dns.records.edit(found.id, {
        content,
        name,
        type: 'TXT',
        path_zone_id: zoneId,
      })
    } else {
      await createRecord(cf, name, cid, zoneId)
    }
  } else {
    await createRecord(cf, name, cid, zoneId)
  }
}

async function run() {
  try {
    const DIR = getInput('dir')
    const CLOUDFLARE_API_KEY = getInput('cf-token')
    const CLOUDFLARE_ZONE_ID = getInput('cf-zone-id')
    const CLOUDFLARE_ZONE_NAME = getInput('cf-zone-name')
    const W3_PRINCIPAL = getInput('w3s-key')
    const W3_PROOF = getInput('w3s-proof')

    // Cloudflare
    const cloudflare = new Cloudflare({
      apiToken: CLOUDFLARE_API_KEY,
    })

    await execa('npx', ['@web3-storage/w3cli', 'space', 'add', W3_PROOF], {
      env: {
        W3_PRINCIPAL,
      },
    })

    const upload = await execa(
      'npx',
      ['@web3-storage/w3cli', 'up', DIR, '--json'],
      {
        env: {
          W3_PRINCIPAL,
        },
      }
    )

    try {
      const jsonOut = JSON.parse(upload.stdout)
      if (jsonOut.root?.['/']) {
        const cid = jsonOut.root['/']
        await upsertRecord(
          cloudflare,
          CLOUDFLARE_ZONE_NAME,
          cid,
          CLOUDFLARE_ZONE_ID
        )

        // ipfs link
        const ipfsLink = `https://w3s.link/ipfs/${cid}`
        setOutput('url', ipfsLink)
        summary.addHeading(
          '<img src="https://docs.ipfs.tech/images/ipfs-logo.svg" height="16px" width="16px" alt="IPFS logo" style="vertical-align: bottom;"/> IPFS Link',
          4
        )
        summary.addLink(ipfsLink, ipfsLink)

        // dns link
        summary.addHeading('🔗 DNS Link', 4)
        const appLink = CLOUDFLARE_ZONE_NAME.replace('_dnslink.', '')
        summary.addLink(
          `https://w3s.link/ipns/${appLink}`,
          `https://w3s.link/ipns/${appLink}`
        )

        // cid
        setOutput('cid', cid)
        summary.addHeading('✨ CID', 4)
        summary.addCodeBlock(cid)
      } else {
        throw new Error(`Failed to upload: ${upload.stdout}`)
      }
    } catch (error) {
      throw new Error('Failed to parse JSON', { cause: error })
    }

    await summary.write()
  } catch (error) {
    const err = /** @type {Error} */ (error)
    setFailed(err.message)
  }
}

run()
