import AlgoTipServer from '../../algo-tip-server/dist/server'
import algosdk from 'algosdk'
import discordJS from 'discord.js'
import config from './config.json'
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
          .setDescription('The amount you wish to tip (in μAlgos)')
          .setRequired(true))
    }

    registerCommands () {
      const commands = [
        this.verifyCommandBuilder(),
        this.tipCommandbuilder()
      ].map(command => command.toJSON())

      const rest = new REST({ version: '9' }).setToken(config.botToken)

      rest.put(Routes.applicationGuildCommands(config.clientID, config.guildID), { body: commands })
        .then(() => console.log('Successfully registered application commands.'))
        .catch(console.error)
    }

    verifyCommand (interaction: discordJS.CommandInteraction) {
      const address = interaction.options.getString('address') as string
      const tag = interaction.user.tag

      this.tipServer.register(tag, address, async (url) => {
        await interaction.reply({ content: `Visit ${url} to verify you own \`${address}\``, ephemeral: true })
      })

      const verifyFunction = () => {
        if (interaction.replied) {
          interaction.editReply(`Verified you own \`${address}\``)
        } else {
          interaction.reply({ content: `Verified you own \`${address}\``, ephemeral: true })
        }

        this.tipServer.events.removeListener(`verify:${tag}-${address}`, verifyFunction)
      }

      this.tipServer.events.addListener(`verify:${tag}-${address}`, verifyFunction)
    }

    tipCommand (interaction: discordJS.CommandInteraction) {
      const to = interaction.options.getUser('to') as discordJS.User
      const from = interaction.user
      const amount = interaction.options.getInteger('amount') as number

      if (to.id === config.clientID) {
        interaction.reply({ content: "You can't tip me... I'm just a bot!", ephemeral: true })
        return
      }

      this.tipServer.tip(from.tag, to.tag, amount, (status: boolean, fromAddress: string, toAddress: string, url?: string, txID?: string) => {
        if (!status) {
          if (!fromAddress) {
            interaction.reply({ content: 'Tip failed! You need to verify your address with `/verify`', ephemeral: true })
          }

          if (!toAddress) {
            interaction.reply({ content: `${to} does not have a verified addres. I sent them a DM to let them know you tried to tip them`, ephemeral: true })
            to.send(`${from} tried to send you a tip but you don't have a verified address. You can use the \`/verify\` command to verify an address for future tips`)
          }
          return
        }

        interaction.reply({ content: `Visit ${url} to send  ${amount.toLocaleString()} μAlgos to ${to}`, ephemeral: true })

        // TODO errorObj type
        const errorFunction = (errorObj: any) => {
          if (errorObj.type === 'unknown') {
            interaction.editReply(`**ERROR:** \`\`\`${errorObj.error}\`\`\``)
          } else if (errorObj.type === 'overspend') {
            interaction.editReply(`**ERROR:** You tried to send ${to} ${amount.toLocaleString()} μAlgos but you only have ${errorObj.balance.toLocaleString()} μAlgos in \`${fromAddress}\``)
          } else if (errorObj.type === 'minBalance') {
            if (errorObj.account === fromAddress) {
              let reply = `**ERROR:** You tried to send ${to} ${amount.toLocaleString()} μAlgos but it would bring your balance to`
              reply += ` ${errorObj.ammountLeft.toLocaleString()} μAlgos which is below the minimum of ${errorObj.min.toLocaleString()} μAlgos`
              interaction.editReply(reply)
            } else {
              interaction.editReply(`You tried to send ${to} ${amount.toLocaleString()} μAlgos but they meet the minimum balance requirement. I will DM them to let them know`)
              to.send(`${from} tried to send you ${amount.toLocaleString()} μAlgos but your doesn't meet the ${errorObj.min.toLocaleString()} μAlgo requirement`)
            }
          }

          this.tipServer.events.removeListener(`error:${txID}`, errorFunction)
        }

        this.tipServer.events.addListener(`error:${txID}`, errorFunction)

        const sentFunction = () => {
          interaction.editReply(`${amount.toLocaleString()} μAlgo tip to ${to} has been sent. It is currently waiting for confirmation. \`${txID})\``)
          this.tipServer.events.removeListener(`sent:${txID}`, sentFunction)
        }

        this.tipServer.events.addListener(`sent:${txID}`, sentFunction)

        const confirmedFunction = () => {
          interaction.editReply(`${amount.toLocaleString()} μAlgo tip to ${to} has been confirmed! \`${txID}\``)
          interaction.channel?.send(`${from} tipped ${to} ${amount.toLocaleString()} μAlgos! \`${txID}\``)
          this.tipServer.events.removeListener(`confirmed:${txID}`, confirmedFunction)
        }

        this.tipServer.events.addListener(`confirmed:${txID}`, confirmedFunction)
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

        this.client.login(config.botToken)
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
  quicksigURL: config.quicksigURL,
  account: algosdk.generateAccount(),
  service: 'Algorand Discord | https://discord.gg/algorand',
  description: 'Proof of wallet ownership is needed for tipping functionality on the official Algorand discord server.',
  url: config.url
} as AlgoTipServer.ServerOptions

const vServer = new AlgoTipServer.Server(serverOptions)

const bot = new DiscordAlgoTipBot.Bot(vServer)
bot.start(3001)
