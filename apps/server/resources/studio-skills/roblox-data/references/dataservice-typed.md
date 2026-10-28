# DataService (typed) by Leif: the Harp default for player data

> Harp addition, not part of the roblox-brain upstream. Checked on 2026-10-20 against the repo
> (`wally.toml`, `docs/intro.md`, `docs/service-functions.md`, `src/*.luau`, version 1.1.0, committed
> 2026-10-03) and the Wally registry. Repo: https://github.com/leifstout/dataServiceTyped. Docs:
> https://leifstout.github.io/dataServiceTyped/docs/intro/

## 1. What it is, and why it is the default

DataServiceTyped ("DataService" below) gives each player a typed, observable data table that saves to
a DataStore and replicates to that player's client.

- Saving and session locking are done by **ProfileStore** (lm-loleris/profilestore), which the library
  wraps. You do not write a DataStore wrapper, a lock protocol, an autosave loop, a `PlayerRemoving`
  save, or a `BindToClose` save. The library starts a session on join and ends it on leave.
- The API is one idea: call a field with no arguments to read it, with a value to set it, with a
  function to update it.
- Server writes replicate to that player's client automatically. The client has a mirror for UI.
- Types come from the template, so `Data[player].inventory.apples()` is typed `number`.
- The user is a professional Roblox developer who uses this on purpose. Use it for any player data or
  DataStore need unless the user explicitly asks for something else. Never hand-roll a wrapper or
  session lock for player data.

It is not for global or cross-server data (leaderboards, world state). Use `roblox-server-data` for
those.

## 2. Install it

Supported install: **Wally**. The package is published in the Wally registry (the registry API lists
versions 1.0.5 and 1.1.0, realm `shared`).

```toml
# wally.toml
[dependencies]
DataServiceTyped = "leifstout/dataservicetyped@1.1.0"
```

Then run `wally install`. The package pulls in `sleitnick/signal@2.0.0` and `leifstout/networker@0.3.1`
(shared) and `lm-loleris/profilestore@1.0.3` (server dependency). You do not install those yourself.

Where it lives, with the usual Rojo + Wally layout:

- `Packages/` is mapped to `ReplicatedStorage.Packages`. The docs require the library as
  `ReplicatedStorage.Packages.DataServiceTyped`, so keep that path.
- `ServerPackages/` is mapped to `ServerScriptService.ServerPackages`. ProfileStore lands here.
- Your own shared data module (`Data`) goes in `ReplicatedStorage`, because the client and the server
  both require it.
- The server startup script goes in `ServerScriptService`.

The docs say to enable Luau's **new type solver** (Workspace property in Studio, or the luau-lsp setting)
so the types and autocomplete work correctly.

Steps for an agent:

1. Look for an existing install first: a `wally.toml` that lists `dataservicetyped`, or
   `ReplicatedStorage.Packages.DataServiceTyped` in the place. If it is there, use it.
2. If the project uses Wally, add the line above and tell the user to run `wally install` (or run it
   yourself if you have a shell in the project). After it runs, confirm `Packages` and `ServerPackages`
   both exist and that `ProfileStore` is present under `ServerPackages`.
3. If the project has no Wally and no Rojo (a Studio-only place), say so to the user. The repo also
   publishes `.rbxm` files on its Releases page (https://github.com/leifstout/dataServiceTyped/releases),
   but the newest one is 1.0.5, older than the Wally 1.1.0, and its internal layout was not checked.
   Do not copy library code into ModuleScripts by hand. Ask the user how they want to install it, and
   after any manual import check that `DataServiceTyped`, `Signal`, `Networker` and `ProfileStore` all
   resolve before writing code against it.

## 3. Declare the data (template and types)

Make one shared module, usually called `Data`, in `ReplicatedStorage`. It builds the template and
returns `DataServiceTyped({ template = template })`.

```luau
-- ReplicatedStorage/Data.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local DataServiceTyped = require(ReplicatedStorage.Packages.DataServiceTyped)

type ItemData = {
	health: number,
	dmg: number,
}

local template = {
	currency = 0,
	inventory = {
		apples = 5,
		oranges = 10,
	},
	settings = {
		music = true,
		sfx = true,
	},
	items = {} :: { [string]: ItemData },
	equippedItemId = nil :: string?,
	questProgress = {} :: { number },
}

return DataServiceTyped({
	template = template,
})
```

Rules for the template:

- Everything saved must be DataStore-safe: numbers, strings, booleans, arrays, dictionaries, and `nil`
  for optional values. No Instances, CFrames, Vector3s, functions, threads, or userdata. Store `x, y, z`
  numbers or a string, and rebuild the Vector3 when you read it.
- Dictionaries need string keys. Arrays are `{ T }` with no holes.
- Annotate empty tables and optional fields (`{} :: { [string]: ItemData }`, `nil :: string?`), or the
  types have nothing to work from. A `nil` field is only a type hint; the key does not exist in the table.
- On join the saved data is reconciled against the template, so **new keys you add to the template
  appear automatically** for existing players.

Options, all optional except `template`:

```luau
return DataServiceTyped({
	template = template,
	profileStoreIndex = "Default",      -- ProfileStore (DataStore) name, default "Default"
	profileStoreDataPrefix = "PLAYER_", -- key prefix before the UserId, default "PLAYER_"
	useMock = false,        -- ProfileStore mock storage (testing)
	viewedUserId = nil,     -- load another user's data without a write session
	overridenUserId = nil,  -- use another user's id as the active profile (spelled "overriden" in the API)
	dontSave = false,       -- load with GetAsync, no write session (read-only testing)
	resetData = false,      -- remove the profile before loading (testing templates)
})
```

The profile key is `profileStoreDataPrefix .. UserId`, so `PLAYER_<UserId>` by default. That keeps the
UserId as a static substring, which matches Roblox right-to-be-forgotten templates.

## 4. Start it on the server

Require the server side and call `Data.Service:init()` **once**, after any overrides such as
`onPlayerInit`.

```luau
-- ServerScriptService/DataServer.server.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Data = require(ReplicatedStorage.Data).server

function Data.Service:onPlayerInit(player, data)
	-- optional: runs after load, before the client gets the data
end

Data.Service:init()
```

`init` creates the ProfileStore, connects `PlayerAdded` and `PlayerRemoving`, and loads players who are
already in the server. Without it nothing loads and clients wait forever. `init` is documented in the
library's source comments, but the Getting Started and Service Functions pages do not mention it, so do
not skip it because those pages do. Calling it twice asserts.

If a profile cannot load, the library kicks the player ("Profile load fail - Please rejoin"). If a
session ends while the player is in game (for example another server took it), it kicks them too. You do
not handle those cases yourself.

## 5. Read, write, update, listen (server)

`Data[player]` is a tree that mirrors your template. It exists only **after that player's data has
loaded**.

```luau
local currency = Data[player].currency()           -- get
local apples = Data[player].inventory.apples()

Data[player].currency(50)                           -- set
Data[player].settings.music(false)
Data[player].equippedItemId("wooden_sword")
Data[player].equippedItemId(nil)                    -- clear an optional value

Data[player].currency(function(currency)            -- update from the old value
	return currency + 10
end)
Data[player].inventory.apples(function(apples)
	return math.max(0, apples - 1)
end)
```

A server write saves with the profile and replicates to that player's client. Pass `false` as the second
argument to skip replication for one write (it still saves):

```luau
Data[player].currency(100, false)
Data[player].currency(function(c) return c + 25 end, false)
```

**Waiting for data.** In code that can run before the profile has loaded (early `PlayerAdded` logic,
another script starting at the same time), use:

```luau
local data = Data.Service:waitForData(player)
if data == nil then
	return -- the player left, or their profile failed to load
end
data.currency(50)
```

Check with `data == nil`. In strict mode the type solver does not narrow `if not data` or
`assert(data)`. After data is loaded, `Data[player].currency(50)` is fine.

**Arrays** (`{ T }` fields) get `Insert`, `Remove`, `OnInsert`, `OnRemove`:

```luau
Data[player].questProgress.Insert(10)
Data[player].questProgress.Insert(15, 2)              -- at position 2
local removed = Data[player].questProgress.Remove(2)  -- by position; no argument removes the last
Data[player].questProgress.Insert(3, nil, false)      -- false = skip replication
Data[player].questProgress.Remove(1, false)

Data[player].questProgress.OnInsert(function(item, position) end)
Data[player].questProgress.OnRemove(function(item, position) end)
```

**Dictionaries** (`{ [string]: T }` fields) behave like nested data. Set a key to `nil` to remove it:

```luau
Data[player].items.sword_001({ health = 0, dmg = 12 })
print(Data[player].items.sword_001.dmg())
Data[player].items.sword_001.dmg(15)
Data[player].items.sword_001(nil)

Data[player].items.OnKeyAdded(function(key, item) end)    -- key goes nil -> value
Data[player].items.OnKeyRemoved(function(key, item) end)  -- key goes value -> nil
```

Changing an existing key fires `Changed`, not `OnKeyAdded`.

**Listening.** `.Changed` works on any field and on parent tables, and returns a disconnect function:

```luau
local disconnect = Data[player].currency.Changed(function(currency, previousCurrency)
	print(previousCurrency, "->", currency)
end)
disconnect()

Data[player].inventory.Changed(function(inventory, previousChildValue, childKey)
	print(childKey, "changed")
end)
```

`Changed` fires on later changes only, not once with the current value. Read the current value yourself
for the first update.

**Do not mutate raw tables you read out.** `local inv = Data[player].inventory()` returns the raw table;
editing it directly skips `Changed`, skips replication, and the client goes stale. Write through the
field calls above. The one exception is the raw `data` table inside `onPlayerInit` and
`addPlayerRemovingCallback`, where direct edits are intended.

## 6. Client replication

Require the client side of the same module:

```luau
local Data = require(ReplicatedStorage.Data).client
```

- This **yields until the server has sent the player's data**. After the require, reads work straight
  away. If the server never calls `Data.Service:init()`, it yields forever.
- Reads and listeners have the same shape as on the server, minus `[player]`:

```luau
local currency = Data.currency()
local apples = Data.inventory.apples()

Data.currency.Changed(function(currency)
	label.Text = tostring(currency)
end)
```

- Client writes (`Data.settings.music(false)`) change only the client mirror and fire client callbacks.
  They are **not saved and not sent to the server**. Anything that must persist or be trusted goes through
  a RemoteEvent; the server validates it and writes `Data[player]`.
- The client mirror is a view for UI. The server never trusts it.
- `.Changed` does not fire for the initial value. Set your UI from `Data.x()` once, then listen.

## 7. Service functions (server only, on `Data.Service`)

| Call                                                | Use                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Data.Service:init()`                               | Start the service. Once, after overrides.                                                                                                      |
| `function Data.Service:onPlayerInit(player, data)`  | Runs after load, before the client gets the data. `data` is the raw table. Put migrations, defaults, and join counters here.                   |
| `Data.Service:waitForData(player)`                  | Yields, returns `Data[player]`, or `nil` if the player left or the load failed.                                                                |
| `Data.Service:addPlayerRemovingCallback(fn)`        | `fn(player, rawData)` runs right before the session ends (last-seen timestamps). Returns a disconnect function.                                |
| `Data.Service:getProfile(player)`                   | The ProfileStore profile, for ProfileStore features the library does not wrap. Normal reads and writes use `Data[player]`.                     |
| `Data.Service:asyncGetProfile(userId)`              | Loads a profile by UserId (admin tools, offline inspection). Read-only use.                                                                    |
| `Data.Service:resetData(player)`                    | Deletes the saved profile and kicks the player. Admin commands and testing only.                                                               |
| `Data.Service:sendGlobalMessage(key, userId, data)` | ProfileStore global message to a user who may be in another server or offline. Returns a boolean.                                              |
| `Data.Service:addGlobalCallback(key, fn)`           | `fn(player, data)` handles messages for `key`. Return `false` to leave the message unprocessed. One callback per key; a duplicate key asserts. |

Global messages fit gifts, purchase grants for players who are in another server, and admin actions.

## 8. Common patterns

**Leaderstats.** The library does not make leaderstats. Build them after the data loads and keep them in
sync with `Changed`:

```luau
local Players = game:GetService("Players")

local function setupLeaderstats(player: Player)
	local data = Data.Service:waitForData(player)
	if data == nil then
		return
	end

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = data.currency()
	coins.Parent = leaderstats

	data.currency.Changed(function(value)
		coins.Value = value
	end)

	leaderstats.Parent = player
end

Players.PlayerAdded:Connect(setupLeaderstats)
for _, player in Players:GetPlayers() do
	task.spawn(setupLeaderstats, player)
end
```

The leaderstats value is for display. The source of truth is always `Data[player]`. A leaderboard across
servers is a separate OrderedDataStore job (`roblox-server-data`).

**Spend or grant.** Do the balance check and the change in one stretch of server code with no yield
between them, as in the example in section 12.

**Rewards for a player who is offline or in another server.** `sendGlobalMessage` plus `addGlobalCallback`.

## 9. Migrations and versioning

DataService has no version field or migration runner of its own. What it does:

1. **Reconcile.** On every load, keys missing from the save are filled in from the template. Adding a
   field to the template needs no migration.
2. **`onPlayerInit(player, data)`.** The place to change old saves. It gets the raw table, before any
   listener exists and before the client receives anything.

Use `onPlayerInit` for renamed fields, changed types, moved fields, removed fields, and clamping bad
values. Keep a version number in the template and step through it:

```luau
-- in the template: dataVersion = 3,
local CURRENT_VERSION = 3

function Data.Service:onPlayerInit(player, data)
	if data.dataVersion < 2 then
		data.currency = data.coins or 0 -- renamed in version 2
		data.coins = nil
	end
	if data.dataVersion < 3 then
		data.settings.sfx = true
	end
	data.dataVersion = CURRENT_VERSION
end
```

Keep each step small and safe to run once. Reconcile runs first and a brand new player gets the
template's `dataVersion`, so set the template version equal to `CURRENT_VERSION` and new players skip
every step. `data` is typed from the template, so reading a field you have removed from the template
needs a cast (`(data :: any).coins`).

Never change `profileStoreIndex` or `profileStoreDataPrefix` after launch. The key is built from both, so
changing either points every player at an empty profile (the old saves are not deleted, they are just no
longer loaded).

## 10. Testing in Studio

- `useMock = true` uses ProfileStore mock storage, so the data is not saved in the real DataStore.
  `dontSave = true` loads without a write session. `resetData = true` removes the profile on every join.
- If real DataStore calls fail in Studio, check Game Settings, Security, "Enable Studio Access to API
  Services", or use `useMock = true`.
- Those are testing switches. Before publishing make sure `useMock`, `dontSave`, `resetData`,
  `viewedUserId` and `overridenUserId` are `false` or `nil`, or players lose data or load someone else's.

## 11. Common mistakes

1. Never calling `Data.Service:init()`. Clients hang on `require(...).client` and no data loads.
2. Calling `init()` before defining `onPlayerInit`, so the override is missed.
3. Reading `Data[player]` right on `PlayerAdded`, before load. It is `nil`. Use `waitForData`.
4. Writing from the client and expecting a save. Client writes are local only.
5. Trusting a RemoteEvent argument. Validate type, range, and ownership on the server, then write.
6. Yielding between a balance check and the debit.
7. Editing the raw table returned by a getter, so `Changed` and replication never fire.
8. Putting Instances, CFrames, Vector3s, or numeric dictionary keys in the template.
9. Forgetting type annotations on empty tables, so `Data[player].items` has no usable types.
10. Using `.server` in a LocalScript or `.client` in a Script. The wrong side is an empty table.
11. Leaving `resetData`, `dontSave`, `useMock`, `overridenUserId`, or `viewedUserId` set in a published
    place.
12. Changing `profileStoreIndex` or `profileStoreDataPrefix` on a live game.
13. Building a second save system, a manual `PlayerRemoving` save, or a `BindToClose` save on top. The
    library owns the session. Use `addPlayerRemovingCallback` for last-moment writes.
14. Using `if not data` after `waitForData` in strict mode. Use `data == nil`.
15. Using `Data.Service:resetData` as a normal feature. It deletes the save and kicks the player.

## 12. Complete minimal example: coins and inventory

Layout (Rojo names):

```
ReplicatedStorage/
	Data.luau                      -- shared data module
	BuyItem                        -- RemoteEvent
ServerScriptService/
	DataServer.server.luau         -- starts DataService, leaderstats, shop
StarterPlayer/StarterPlayerScripts/
	CoinsHud.client.luau           -- client display and buy request
```

Create the `BuyItem` RemoteEvent in `ReplicatedStorage` (a Rojo `.model.json` or the Studio Explorer both
work).

```luau
-- ReplicatedStorage/Data.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local DataServiceTyped = require(ReplicatedStorage.Packages.DataServiceTyped)

local template = {
	dataVersion = 1,
	coins = 0,
	inventory = {} :: { [string]: number }, -- itemId -> how many owned
}

return DataServiceTyped({
	template = template,
})
```

```luau
-- ServerScriptService/DataServer.server.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Data = require(ReplicatedStorage.Data).server
local buyItem = ReplicatedStorage:WaitForChild("BuyItem") :: RemoteEvent

local PRICES: { [string]: number } = {
	sword = 50,
	shield = 30,
}

function Data.Service:onPlayerInit(player, data)
	-- migrations and one-time fixes go here (see section 9)
	if data.coins < 0 then
		data.coins = 0
	end
end

Data.Service:init()

local function setupLeaderstats(player: Player)
	local data = Data.Service:waitForData(player)
	if data == nil then
		return
	end

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = data.coins()
	coins.Parent = leaderstats

	data.coins.Changed(function(value)
		coins.Value = value
	end)

	leaderstats.Parent = player
end

Players.PlayerAdded:Connect(setupLeaderstats)
for _, player in Players:GetPlayers() do
	task.spawn(setupLeaderstats, player)
end

-- Grant coins from gameplay (a pickup, a quest).
local function giveCoins(player: Player, amount: number)
	local data = Data[player]
	if data == nil then
		return
	end
	data.coins(function(coins)
		return coins + amount
	end)
end

-- The client asks to buy; the server decides.
buyItem.OnServerEvent:Connect(function(player: Player, itemId: unknown)
	if typeof(itemId) ~= "string" then
		return
	end
	local price = PRICES[itemId]
	if price == nil then
		return
	end

	local data = Data[player]
	if data == nil then
		return -- data not loaded yet
	end
	if data.coins() < price then
		return
	end

	-- no yield between the check above and the writes below
	data.coins(function(coins)
		return coins - price
	end)
	data.inventory[itemId](function(count)
		return (count or 0) + 1
	end)
end)

-- Example use of giveCoins: 10 coins every 30 seconds for everyone in the server.
task.spawn(function()
	while true do
		task.wait(30)
		for _, player in Players:GetPlayers() do
			giveCoins(player, 10)
		end
	end
end)
```

```luau
-- StarterPlayer/StarterPlayerScripts/CoinsHud.client.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Data = require(ReplicatedStorage.Data).client -- yields until the server sent our data
local buyItem = ReplicatedStorage:WaitForChild("BuyItem") :: RemoteEvent

local gui = Instance.new("ScreenGui")
gui.Name = "CoinsHud"
gui.ResetOnSpawn = false

local label = Instance.new("TextLabel")
label.Size = UDim2.fromOffset(260, 40)
label.Position = UDim2.fromOffset(16, 16)
label.BackgroundTransparency = 0.3
label.TextScaled = true
label.Parent = gui

local button = Instance.new("TextButton")
button.Size = UDim2.fromOffset(260, 40)
button.Position = UDim2.fromOffset(16, 64)
button.Text = "Buy sword (50)"
button.TextScaled = true
button.Parent = gui

local function refresh()
	local swords = Data.inventory.sword() or 0
	label.Text = `Coins: {Data.coins()}  Swords: {swords}`
end

refresh() -- Changed does not fire for the initial value
Data.coins.Changed(refresh)
Data.inventory.Changed(refresh)

button.Activated:Connect(function()
	buyItem:FireServer("sword") -- the server checks price and balance
end)

gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
```

When unsure how DataService works, read the docs at https://leifstout.github.io/dataServiceTyped/docs/intro/ instead of guessing or reading the library's code.
