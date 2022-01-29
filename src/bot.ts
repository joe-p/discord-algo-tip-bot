import AlgoTipBot from '../../algo_tip_bot/dist/server'
import algosdk from 'algosdk'
import discordJS from 'discord.js'
import secrets from './secrets.json'
import { SlashCommandBuilder } from '@discordjs/builders'
import { REST } from '@discordjs/rest'
import { Routes } from 'discord-api-types/v9'

export namespace AlgoDiscordTipBot {
  export class Bot {
    constructor () {
      console.log(2)
    }
  }
}

const algodServer = 'http://192.168.1.212'
const algodToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const options = {
  algodClient: new algosdk.Algodv2(algodToken, algodServer, 4001),
  database: 'sqlite://db.sqlite',
  quicksigURL: 'http://192.168.1.212:3000',
  account: algosdk.generateAccount(),
  service: 'Algorand Discord | https://discord.gg/algorand',
  description: 'Proof of wallet ownership is needed for tipping functionality on the official Algorand discord server.',
  url: 'http://192.168.1.212:3001'
} as AlgoTipBot.VerificationServerOptions

const server = new AlgoTipBot.VerificationServer(options)
const port = 3001

function registerCommands () {
  const commands = [
    new SlashCommandBuilder().setName('verify')
      .setDescription('Verifies you own a paticular Algorand address')
      .addStringOption(option => option.setName('address')
        .setDescription('The address you claim to own')
        .setRequired(true))
  ].map(command => command.toJSON())

  const rest = new REST({ version: '9' }).setToken(secrets.botToken)

  rest.put(Routes.applicationGuildCommands(secrets.clientID, secrets.guildID), { body: commands })
    .then(() => console.log('Successfully registered application commands.'))
    .catch(console.error)
}

server.start(port, () => {
  console.log(`Listening on port ${port}`)
  // Create a new client instance
  const client = new discordJS.Client({ intents: [discordJS.Intents.FLAGS.GUILDS] })

  // When the client is ready, run this code (only once)
  client.once('ready', () => {
    console.log('Ready!')
  })

  // Login to Discord with your client's token
  client.login(secrets.botToken)
  registerCommands()

  client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return

    const { commandName } = interaction

    if (commandName === 'verify') {
      const interactionAddress = interaction.options.getString('address') as string
      const interactionTag = interaction.user.tag

      server.register(interactionTag, interactionAddress, async (url) => {
        await interaction.reply(`Visit ${url} to verify you own ${interactionAddress}`)
      })

      const verifyFunction = (user: string, userAddress: string) => {
        if (user === interactionTag || userAddress === interactionAddress) {
          interaction.editReply(`Verified ${user} owns ${userAddress}`)
          server.events.removeListener('verify', verifyFunction)
        }
      }

      server.events.addListener('verify', verifyFunction)
    }
  })
})
