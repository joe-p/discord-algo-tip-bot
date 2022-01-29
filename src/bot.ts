import AlgoTipBot from '../../algo_tip_bot/dist/server'
import algosdk from 'algosdk'
import discordJS from 'discord.js'
import secrets from './secrets.json'
import { SlashCommandBuilder } from '@discordjs/builders'
import { REST } from '@discordjs/rest'
import { Routes } from 'discord-api-types/v9'

export namespace AlgoDiscordTipBot {
  export class Bot {
    client: discordJS.Client
    verificationServer : AlgoTipBot.VerificationServer

    constructor (verificationServer: AlgoTipBot.VerificationServer) {
      this.verificationServer = verificationServer
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

      this.verificationServer.register(interactionTag, interactionAddress, async (url) => {
        await interaction.reply(`Visit ${url} to verify you own ${interactionAddress}`)
      })

      const verifyFunction = (user: string, userAddress: string) => {
        if (user === interactionTag || userAddress === interactionAddress) {
          if (interaction.replied) {
            interaction.editReply(`Verified ${user} owns ${userAddress}`)
          } else {
            interaction.reply(`Verified ${user} owns ${userAddress}`)
          }

          this.verificationServer.events.removeListener('verify', verifyFunction)
        }
      }

      this.verificationServer.events.addListener('verify', verifyFunction)
    }

    tipCommand (interaction: discordJS.CommandInteraction) {
      const to = interaction.options.getUser('to') as discordJS.User
      const from = interaction.user
      const amount = interaction.options.getInteger('amount') as number

      this.verificationServer.tip(from.tag, to.tag, amount, (status: boolean, fromAddress: string, toAddress: string, url?: string, txID?: string) => {
        if (!status) {
          if (!fromAddress && !toAddress) {
            interaction.reply(`Tip FAILED! ${from} and ${to} need to verify their addresses with /verify`)
          } else if (!fromAddress) {
            interaction.reply(`Tip FAILED! ${from} needs to verify their address with /verify`)
          } else if (!toAddress) {
            interaction.reply(`Tip FAILED! ${to} needs to verify their address with /verify`)
          }
          return
        }

        interaction.reply(`Visit ${url} to send a tip to ${to}`)

        const sentFunction = (sentTxID: string) => {
          if (sentTxID !== txID) {
            return
          }

          interaction.editReply(`Tip of ${amount} from ${from} to ${to} | ${txID} | Sent`)
          this.verificationServer.events.removeListener('sent', sentFunction)
        }

        this.verificationServer.events.addListener('sent', sentFunction)

        const confirmedFunction = (sentTxID: string) => {
          if (sentTxID !== txID) {
            return
          }

          interaction.editReply(`Tip of ${amount} from ${from} to ${to} | ${txID} | Verified!`)
          this.verificationServer.events.removeListener('sent', confirmedFunction)
        }

        this.verificationServer.events.addListener('sent', confirmedFunction)
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
      this.verificationServer.start(port, () => {
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
} as AlgoTipBot.VerificationServerOptions

const vServer = new AlgoTipBot.VerificationServer(serverOptions)

const bot = new AlgoDiscordTipBot.Bot(vServer)
bot.start(3001)
