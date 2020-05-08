import {exec} from "child_process"
import fs = require("fs")
import path = require("path")
import util = require("util")

import {Sequelize, DataTypes, Model} from "sequelize"

const promiseExec = util.promisify(exec)

const databasePath = path.join(process.cwd(), "data")
const databaseFilename = "blackbox.db"

const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(databasePath, databaseFilename)
})

class Player extends Model {}
Player.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    displayName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    secretKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    timeCreated: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
}, {
    sequelize,
    modelName: "Player",
});

class GameSession extends Model {}
GameSession.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    inviteCode: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    timeCreated: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    gameState: {
        type: DataTypes.STRING,
        allowNull: false,
    }
}, {
    sequelize,
    modelName: "GameSession",
})

class GameSessionSeat extends Model {}
GameSessionSeat.init({
    seatNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
}, {
    sequelize,
    modelName: "GameSessionSeat",
})

// "Super Many-to-Many":
// https://sequelize.org/master/manual/advanced-many-to-many.html#the-best-of-both-worlds--the-super-many-to-many-relationship
Player.belongsToMany(GameSession, {through: GameSessionSeat})
GameSession.belongsToMany(Player, {through: GameSessionSeat})
Player.hasMany(GameSessionSeat)
GameSessionSeat.belongsTo(Player)
GameSession.hasMany(GameSessionSeat)
GameSessionSeat.belongsTo(GameSession)

async function executeSubprocess(command: string, quiet: boolean = false) {
    if (!quiet) {
        console.log(`Running subprocess: \`${command}\``)
    }
    const results = await promiseExec(command)
    if (!quiet) {
        const sep = "===================="
        console.log(
            `  + stdout:\n` +
            `${sep}\n${results.stdout}\n${sep}\n` +
            `  + stderr:\n` +
            `${sep}\n${results.stderr}\n${sep}`
        )
    }
    return results;
}

/**
 * Initializes the SQLite database. This should always be done before interacting with any models.
 */
async function sqliteDBInit() {
    const databaseLocation = path.join(databasePath, databaseFilename)
    console.log(`Initializing SQLite DB at location: ${databaseLocation}`)

    if (!fs.existsSync(databasePath)) {
        console.log(`Database path "${databasePath}" doesn't exist; making directory...`)
        fs.mkdirSync(databasePath, {recursive: true})
    }

    console.log("Touching database file with sqlite3...")
    // Open the database file using the sqlite3 CLI.
    // This is a hack to create a valid empty database if the file doesn't exist.
    await executeSubprocess(`sqlite3 ${databaseLocation} ".databases"`)

    console.log("Synchronizing database...")
    await sequelize.sync();
}

export {sqliteDBInit, Player, GameSession, GameSessionSeat}
