Express = require 'express'
Fs = require 'fs'
App = Express()
ImageType = require 'image-type'
Exec = require('child_process').exec

try
	App.set 'port', process.env.PORT or 80

catch e
	console.log e

App.listen App.get('port'), () ->
	console.log "Started print server at localhost:" + App.get 'port'

App.get '/', (req, res) ->
	res.end "Thanks for visiting"

App.get '/photobooth', (req, res) ->
	res.writeHead 404
	res.end "Try POSTing"

App.options '/photobooth', (req, res) ->
	res.writeHead 200, {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'authorization',
	}
	res.end ""

App.post '/photobooth', (req, res) ->
	if req.headers['authorization'] isnt 'StephensShortsAreSoShortShort'
		res.writeHead 404
		return res.end "Nope"

	data = null

	req.on 'data', (chunk) ->
		data = if data then Buffer.concat([data, chunk]) else chunk
	
	req.on 'end', ->
		console.log "Got image: length: #{data.length}"

		encdata = data.toString().substr(23)

		bdata = new Buffer(encdata, 'base64')

		ts = parseInt(new Date().getTime() / 1000)
		type = ImageType bdata

		console.log "type: ", type

		unless type
			console.log "Couldn't find proper type for file"
		else
			Fs.writeFile "photos/#{ts}.jpg", bdata, (err) ->
				if err
					res.writeHead 500
					console.log "There was an error writing to photos/#{ts}.jpg: #{err}"

					res.end "Failure"
				else
					res.writeHead 200

					Exec "lpr -P Canon_MG6600_series photos/#{ts}.jpg", (err, stdout, stderr) ->
						console.log "Printed!"

					res.end "Thanks!"
