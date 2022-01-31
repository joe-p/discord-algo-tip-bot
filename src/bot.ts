import AlgoTipServer from '../../algo_tip_bot/dist/server'
import algosdk from 'algosdk'
import discordJS from 'discord.js'
import secrets from './secrets.json'
import { SlashCommandBuilder } from '@discordjs/builders'
import { REST } from '@discordjs/rest'
import { Routes } from 'discord-api-types/v9'

export namespace DiscordAlgoTipBot {
  export class Bot {
    client: discordJS.Client
    tipServer : AlgoTipServer.Server

    constructor (tipServer: AlgoTipServer.Server) {
      this.tipServer = tipServer
      this.client = new discordJS.Client({ intents: [discordJS.Intents.FLAGS.GUILDS] })
    }

    verifyCommandBuilder () {
      return new SlashCommandBuilder().setName('verify')
        .setDescription('Verifies you own a paticular Algorand address')
        .addStringOption(option => option.setName('address')
          .setDescription('The address you claim to own')
          .setRequired(true))
    }

    tipCommandbuilder () {
      return new SlashCommandBuilder().setName('tip')
        .setDescription('Tip a user with algo')
        .addUserOption(option => option.setName('to')
          .setDescription('The user you wish to tip')
          .setRequired(true))
        .addIntegerOption(option => option.setName('amount')
          .setDescription('The amount you wish to tip')
          .setRequired(true))
    }

    registerCommands () {
      const commands = [
        this.verifyCommandBuilder(),
        this.tipCommandbuilder()
      ].map(command => command.toJSON())

      const rest = new REST({ version: '9' }).setToken(secrets.botToken)

      rest.put(Routes.applicationGuildCommands(secrets.clientID, secrets.guildID), { body: commands })
        .then(() => console.log('Successfully registered application commands.'))
        .catch(console.error)
    }

    verifyCommand (interaction: discordJS.CommandInteraction) {
      const interactionAddress = interaction.options.getString('address') as string
      const interactionTag = interaction.user.tag

      this.tipServer.register(interactionTag, interactionAddress, async (url) => {
        await interaction.reply({ content: `Visit ${url} to verify you own ${interactionAddress}`, ephemeral: true })
      })

      const verifyFunction = (user: string, userAddress: string) => {
        if (user === interactionTag || userAddress === interactionAddress) {
          if (interaction.replied) {
            interaction.editReply(`Verified you own ${userAddress}`)
          } else {
            interaction.reply({ content: `Verified you own ${userAddress}`, ephemeral: true })
          }

          this.tipServer.events.removeListener('verify', verifyFunction)
        }
      }

      this.tipServer.events.addListener('verify', verifyFunction)
    }

    tipCommand (interaction: discordJS.CommandInteraction) {
      const to = interaction.options.getUser('to') as discordJS.User
      const from = interaction.user
      const amount = interaction.options.getInteger('amount') as number

      this.tipServer.tip(from.tag, to.tag, amount, (status: boolean, fromAddress: string, toAddress: string, url?: string, txID?: string) => {
        if (!status) {
          if (!fromAddress) {
            interaction.reply({ content: 'Tip failed! You need to verify your address with `/verify`', ephemeral: true })
          }

          if (!toAddress) {
            to.send(`${from} tried to send you a tip but you don't have a verified address. You can use the \`/verify\` command to verify an address for future tips`)
          }
          return
        }

        interaction.reply({ content: `Visit ${url} to send  ${amount} to ${to}`, ephemeral: true })

        const sentFunction = (sentTxID: string) => {
          if (sentTxID !== txID) {
            return
          }

          interaction.editReply(`${amount} tip to ${to} has been sent. It is current waiting for confirmation. \`${txID})\``)
          this.tipServer.events.removeListener('sent', sentFunction)
        }

        this.tipServer.events.addListener('sent', sentFunction)

        const confirmedFunction = (sentTxID: string) => {
          if (sentTxID !== txID) {
            return
          }

          interaction.editReply(`${amount} tip to ${to} has been verified! \`${txID}\``)
          interaction.channel?.send(`${from} tipped ${to} ${amount}! \`${txID}\``)
          this.tipServer.events.removeListener('sent', confirmedFunction)
        }

        this.tipServer.events.addListener('sent', confirmedFunction)
      })
    }

    handleCommands () {
      this.client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return

        const { commandName } = interaction

        if (commandName === 'verify') {
          this.verifyCommand(interaction)
        } else if (commandName === 'tip') {
          this.tipCommand(interaction)
        }
      })
    }

    start (port: number) {
      this.tipServer.start(port, () => {
        console.log(`Listening on port ${port}`)

        this.client.login(secrets.botToken)
        this.registerCommands()
        this.handleCommands()
      })
    }
  }
}

const algodServer = 'https://testnet-api.algonode.cloud'
const algodToken = ''

const serverOptions = {
  algodClient: new algosdk.Algodv2(algodToken, algodServer, ''),
  database: 'sqlite://db.sqlite',
  quicksigURL: 'http://192.168.1.212:3000',
  account: algosdk.generateAccount(),
  service: 'Algorand Discord | https://discord.gg/algorand',
  description: 'Proof of wallet ownership is needed for tipping functionality on the official Algorand discord server.',
  url: 'http://192.168.1.212:3001'
} as AlgoTipServer.ServerOptions

const vServer = new AlgoTipServer.Server(serverOptions)

const bot = new DiscordAlgoTipBot.Bot(vServer)
bot.start(3001)
