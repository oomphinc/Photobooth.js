/**
 * TODO
 * - use requestAnimationFrame or fallback to setInterval
 */

;(function(window,document) {

var defaults = {
		orientation: 'landscape', // or portrait or portrait-cc (i.e. counter-clockwise)
		refreshRate: 33, //ms to repaint canvas
		shots: 4, // number of shots to take
		shotDelay: 4000, //ms between shots
		imageType: 'image/png', //export type once render is complete
		flashDur: 200, //duration of flash
		flashFade: 300, //duration of flash fadeout...0 disables the flash
		print: false,
		resolution: [320, 240], // [640, 480]
		previewQuality: 1, //percentage quality (of main resolution) for the preview video (can be >1)
		tickRate: 100, //ms to run the runner
		mirror: true, //mirror the video preview?
		//events, e.g. on____
		background: 'white', //fill color under snaps or false for clear
		// options for the default grid rendering functions:
		outer: 0, //spacing between edge of render and edge of snap
		inner: 0, //spacing between edge of snap and edge of snap
		across: 1, //number of snaps per line
	}
	, PhotoBoothException = function(msg) {
		this.message = msg;
	}
	, URL = window.URL || window.webkitURL //smooth out vender prefix
	// return a unique auto-incremented id for the current browser session
	, guid = (function(){
		var counter = 0;
		return function() {
			return ++counter;
		}
	})()
	// constant to convert degrees to radians
	, TO_RADIANS = Math.PI / 180
	//simple closure that converts a value into a function that returns that value
	//two reserved words concatenated = suck it, JS!
	, returnThis = function(what) {
		return function() {
			return what;
		}
	}
	// fire a function once the DOM is loaded
	, bodyReady = function(fn) {
		if (typeof fn!=='function') return;
		if (document.body) {
			// MY BODY IS READY
			fn();
		} else {
			document.addEventListener('DOMContentLoaded', fn);
		}
	}
;

PhotoBoothException.prototype = {
	toString: function() {
		return this.name + ': ' + this.message;
	},
	name: 'PhotoBoothException',
}

// add some styles for the flash
var $style = document.createElement('style');
$style.type = 'text/css';
$style.innerHTML = '.photo-flash { background-color: white; position: fixed; top: 0px; left: 0px; bottom: 0px; right: 0px; z-index: 999; display: none; }';
document.getElementsByTagName('head')[0].appendChild($style);

// smooth out vendor prefixes
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

// the main object
var PB = window.PhotoBooth = function(options) {
	var self = this
		, settings = {} //user defined settings
		, events = {} //event handlers
		, filters = [] //photo filters for video
		, selectedFilter //index of selected filter
		, $container //overall container to apply status classes to
		, intervalID // setInterval ID for when the sequence is running
		, $preview = document.createElement('canvas')
		, previewContext = $preview.getContext('2d')
		, $snap = document.createElement('canvas')
		, snapContext = $snap.getContext('2d')
		, $render = document.createElement('canvas')
		, renderContext = $render.getContext('2d')
		, refreshID // setInterval ID for repainting the canvas
		, $video = document.createElement('video')
		, $printWin // hidden iframe if printing is enabled
		, isStreaming = false //whether video stream is active
		, isSnapping = false //whether a session is underway
		, width //lock in these values for consistency
		, height
		, previewWidth
		, previewHeight
		, portrait //whether we are in portrait mode, bc sometimes width / height would need to be swapped
		, timerVal //if the session is paused, save the remaining countdown of current shot
		, timerStart //timestamp at start of countdown
		, shots //number of shots in a session, locked in while session is in progress
		, shotDelay //delay between shots, locked in while session is in progress
		, snaps = [] //holder for the snap image data, also acts as a running count of how many have been taken
	;

	// can we even get the video feed?
	if (typeof navigator.getUserMedia!=='function') {
		throw new PhotoBoothException('getUserMedia is not supported in this browser.');
	}

	// if PhotoBooth wasn't invoked with new
	if (this===window || !(this instanceof PB)) {
		return new PB(options);
	}

	// generic canvas that can be used for image manipulations / rendering
	this.canvas = {};
	this.canvas.el = document.createElement('canvas');
	this.canvas.context = this.canvas.el.getContext('2d');
	// clear the canvas and optionally update the width/height
	this.canvas.reset = function(width,height) {
		// setting the width resets the canvas completely, even if set to the same width
		self.canvas.el.width = width ? width : self.canvas.el.width;
		if (height) self.canvas.el.height = height;
	}

	// repaint the preview canvas
	var repaint = function() {
		if ($video.paused || $video.ended || self.stream.ended) {
			streamEnded();
			return;
		}
		previewContext.drawImage($video, 0, 0, previewWidth, previewHeight);
		// bail early for normal filter to avoid unnecessary processing
		if (filters[selectedFilter].type==='none') {
			return;
		}
		// need to swap width and height when in portrait mode
		var img = previewContext.getImageData(0, 0, portrait ? previewHeight : previewWidth, portrait ? previewWidth : previewHeight);
		previewContext.putImageData(runFilter(img), 0, 0);
	}

	// run image data object through the currently selected filter
	var runFilter = function(img) {
		switch (filters[selectedFilter].type) {
			case 'pixel':
				// faster than looking up in each loop iteration
				var fn = filters[selectedFilter].fn;
				// loop on the pixels
				for (var i = 0; i < img.data.length; i += 4) {
					//pass the pixel components (r,g,b,a) through the pixel filter
					var newPixel = fn(img.data[i], img.data[i+1], img.data[i+2], img.data[i+3]);
					img.data[i] = newPixel[0];
					img.data[i+1] = newPixel[1];
					img.data[i+2] = newPixel[2];
					img.data[i+3] = newPixel[3];
				}
			break;

			case 'full':
				img = filters[selectedFilter].fn(img);
			break;
		}
		return img;
	}

	// clean up after the stream has stopped (may be triggered by various means)
	var streamEnded = function() {
		if (isStreaming) {
			self.trigger('videoended');
			self.stream.stop();
			isStreaming = false;
		}
	}

	// start previewing the video (i.e. painting the video feed onto the preview canvas)
	this.previewStart = function() {
		if (!isStreaming) {
			throw new PhotoBoothException('Video stream is not active.');
		// make sure preview is not already running
		} else if (typeof refreshID==='undefined') {
			$container.classList.add('video-on');
			$container.classList.remove('video-off');
			refreshID = setInterval(repaint, self.getOption('refreshRate'));
			self.trigger('previewstart');
		}
		return self;
	}

	// stop previewing the video (only stops repainting the preview canvas-- video feed remains untouched)
	this.previewStop = function() {
		// is the preview even running?
		if (typeof refreshID!=='undefined') {
			clearInterval(refreshID);
			refreshID = void(0); // set to undefined
			$container.classList.add('video-off');
			$container.classList.remove('video-on');
			self.trigger('previewend');
		}
		return self;
	}

	// request the video feed from the user
	this.requestVideo = function() {
		navigator.getUserMedia({ video: true, audio: false },
			// success! we have a stream
			function(stream) {
				// make the stream reference publicly available
				self.stream = stream;
				// FF does not implement addEventListener for streams :(
				if (stream.addEventListener) stream.addEventListener('ended',streamEnded);
				$video.src = URL ? URL.createObjectURL(stream) : stream;
				$video.addEventListener('canplay', function() {
					if (!isStreaming) {
						// lock in the width and height from options
						var res = self.getOption('resolution');
						width = res[0];
						height = res[1];
						// adjust height according to actual aspect ratio of video feed
						if ($video.videoWidth > 0) height = $video.videoHeight / ($video.videoWidth / width);
						// relative size of preview to snapshot resolution -- must be > 0 otherwise defaults to 1
						var qual = Math.max(self.getOption('previewQuality'),0) || 1;
						previewWidth = width * qual;
						previewHeight = height * qual;
						$snap.setAttribute('width', width);
						$snap.setAttribute('height', height);
						// set up the preview canvas based on orientation settings
						switch (self.getOption('orientation')) {
							// portrait with camera turned counter-clockwise
							case 'portrait-cc':
								portrait = true;
								// width and height are swapped
								$preview.setAttribute('width', previewHeight);
								$preview.setAttribute('height', previewWidth);
								previewContext.rotate(90*TO_RADIANS);
								if (self.getOption('mirror')) {
									previewContext.scale(1, -1);
								} else {
									previewContext.translate(0, -previewHeight);
								}
							break;

							// portrait with camera turned clockwise
							case 'portrait':
								portrait = true;
								// width and height are swapped
								$preview.setAttribute('width', previewHeight);
								$preview.setAttribute('height', previewWidth);
								previewContext.rotate(-90*TO_RADIANS);
								if (self.getOption('mirror')) {
									previewContext.scale(1, -1);
									previewContext.translate(-previewWidth,-previewHeight);
								} else {
									previewContext.translate(-previewWidth, 0);
								}
							break;

							// default is landscape
							default:
								portrait = false;
								$preview.setAttribute('width', previewWidth);
								$preview.setAttribute('height', previewHeight);
								if (self.getOption('mirror')) {
									previewContext.translate(previewWidth, 0);
									previewContext.scale(-1, 1);
								}
						}
						// allow for direct transformations on the preview canvas context
						self.trigger('previewcanvascontext',[previewContext, previewWidth, previewHeight])
						// width and height are swapped in portrait mode
						isStreaming = true;
						$video.play();
					}
				});
				$video.addEventListener('play', function() {
					self.trigger('videostarted');
					self.previewStart();
				});
				$video.addEventListener('ended', streamEnded);
			},
			// error - we couldn't get the stream!
			function(error) {
				throw new PhotoBoothException('Video could not be loaded: ' + error.name);
			}
		);
	}

	this.setOption = function(option,value) {
		//set multiple values at once by passing an object hash
		if (typeof option==='object') {
			for (key in option) {
				if (option.hasOwnProperty(key)) {
					this.setOption(key,option[key]);
				}
			}
		} else if (Object.keys(defaults).indexOf(option)>=0) {
			settings[option] = value;
		}
		return this;
	}

	// get user set option or fallback to default
	this.getOption = function(option) {
		return typeof settings[option]==='undefined' ? defaults[option] : settings[option];
	}

	this.getWidth = function() {
		return width;
	}

	this.getHeight = function() {
		return height;
	}

	this.isPortrait = function() {
		return !!portrait;
	}

	// using the container element, check if a status class is present
	this.is = function(what) {
		return $container.classList.contains(what);
	}

	// attach a handler to an event
	this.on = function(type,handler) {
		type = type.toLowerCase();
		if (typeof handler==='function') {
			events[type] = events[type] || [];
			events[type].push(handler);
		}
		return this;
	}

	// detach a handler from an event
	this.off = function(type,handler) {
		type = type.toLowerCase();
		if (events[type]) {
			for (var i=0; i<events[type].length; i++) {
				if (events[type][i]===handler) {
					events[type].splice(i,1);
					break;
				}
			}
		}
		return this;
	}

	// TRIGGER WARNING!!!
	// trigger an event -- context is optional, defaults to this PhotoBooth object
	// returns false if *any* handler returned false, otherwise true
	this.trigger = function(type,context,args) {
		var returnVal = true;
		if (!Array.isArray(events[type])) return returnVal;
		if (arguments.length<3) {
			args = context;
			context = false;
		}
		context = context || this;
		args = Array.isArray(args) ? args : [];
		for (var i=0; i<events[type].length; i++) {
			returnVal = events[type][i].apply(context,args)===false ? false : returnVal;
		}
		return returnVal;
	}

	// tick during a snap session
	var tick = function() {
		var remaining = Math.max(shotDelay - (Date.now() - timerStart),0);
		self.trigger('tick',[remaining]);
		//time for another snap!
		if (remaining === 0) {
			snap();
			$container.classList.remove('snap-'+snaps.length);
			//shall we keep going?
			if (snaps.length<shots) {
				timerStart = Date.now();
				self.trigger('countdownstart');
				$container.classList.add('snap-'+(snaps.length+1));
			} else {
				self.trigger('complete');
				self.stop();
				// delay by one tick
				setTimeout(function() {
					render.call(self);
					var imgSrc = $render.toDataURL(self.getOption('imageType'));
					self.trigger('save',[imgSrc]);
					if (self.getOption('print')) {
						self.print();
					}
				}, self.getOption('tickRate'));
			}
		}
	}

	// take a snapshot and save!
	var snap = function() {
		self.trigger('snap',[snaps.length+1]);
		PB.flash(self.getOption('flashDur'), self.getOption('flashFade'), function(){
			self.trigger('flashend');
		});
		// push a new snap
		snaps.push(self.captureFrame(true,'HTMLImageElement'));
	}

	// capture current image from video feed
	this.captureFrame = function(withFilter,type,typeOptions) {
		if (!isStreaming) {
			throw new PhotoBoothException('Video stream is not active.');
		}
		snapContext.drawImage($video, 0, 0, width, height);
		var img = snapContext.getImageData(0, 0, width, height);
		if (withFilter) {
			img = runFilter(img);
		}
		if (type==='HTMLImageElement') {
			typeOptions = typeOptions || [];
			snapContext.putImageData(img,0,0);
			img = new Image();
			img.src = $snap.toDataURL();
		}
		return img;
	}

	var render = function() {
		var processImage = this.getOption('processImage')
			, imageSize = this.getOption('imageSize')
			, positionFn = this.getOption('position')
			, position
		;
		this.trigger('beforerender');
		$container.classList.add('rendering');
		// get the canvas size
		var canvasSize = this.getOption('canvasSize').call(this);
		// resize the canvas (which also clears it)
		$render.width = canvasSize[0];
		$render.height = canvasSize[1];
		// fill the canvas with the bg color, if not falsey
		if (renderContext.fillStyle = this.getOption('background')) {
			renderContext.fillRect(0, 0, canvasSize[0], canvasSize[1]);
		} else {
			renderContext.clearRect(0, 0, canvasSize[0], canvasSize[1]);
		}
		this.trigger('beforerendersnaps',[renderContext,snaps]);
		// draw the snaps
		for (var i=0; i<snaps.length; i++) {
			position = positionFn.call(this,i+1);
			renderContext.drawImage(processImage.call(this,snaps[i],i+1),position[0],position[1]);
		}
		this.trigger('afterrendersnaps',[renderContext]);
		$container.classList.remove('rendering');
		this.trigger('afterrender',[renderContext]);
	}

	this.print = function() {
		// add the hidden print iframe - once!
		if (!$printWin) {
			$printWin = document.createElement('iframe');
			$printWin.style.display = 'none';
			$printWin.src = 'about:blank';
			$container.appendChild($printWin);
		}
		self.trigger('beforeprint');
		var img = new Image();
		img.src = $render.toDataURL(self.getOption('imageType'));
		$printWin.contentWindow.document.body.innerHTML = '';
		$printWin.contentWindow.document.body.appendChild(img);
		$printWin.contentWindow.print();
		self.trigger('afterprint');
	}

	// start from stopped or paused
	this.start = function() {
		// we need the video stream!
		if (!isStreaming) {
			throw new PhotoBoothException('Video stream is not active!');
		}
		// we are already snapping!
		if (isSnapping && timerVal===false) return this;
		$container.classList.add('started');
		$container.classList.remove('paused','stopped');
		if (!isSnapping) {
			isSnapping = true;
			// clear the snaps array
			snaps.length = 0;
			//lock these in during a snap session
			shots = this.getOption('shots');
			shotDelay = this.getOption('shotDelay');
			timerStart = Date.now();
			this.trigger('start');
			this.trigger('countdownstart');
			$container.classList.add('snap-1');
		} else {
			this.trigger('resume');
			//set the start back in time since we are just resuming, but only if there was actually time remaining
			timerStart = Date.now() - (timerVal===0 ? 0 : shotDelay - timerVal);
		}
		timerVal = false;
		intervalID = setInterval(tick,this.getOption('tickRate'));
		return this;
	}

	// pause acts as toggle to start or resume
	this.pause = function() {
		if (isSnapping) {
			// we better not be paused already!
			if (timerVal===false) {
				//lock in the remaining time
				timerVal = Math.max(shotDelay - (Date.now() - timerStart),0);
				$container.classList.add('paused');
				this.trigger('pause');
				clearInterval(intervalID);
			} else {
				// we are already paused! so just resume
				this.start();
			}
		}
		return this;
	}

	// stop the session, if running
	this.stop = function() {
		$container.classList.add('stopped');
		$container.classList.remove('paused','started','snap-'+snaps.length,'snap-'+(snaps.length+1));
		isSnapping = false;
		timerVal = false;
		clearInterval(intervalID);
		this.trigger('stop');
		return this;
	}

	var getFilterIndexByName = function(name) {
		for (var i=0; i<filters.length; i++) {
			if (filters[i].name===name) {
				return i;
			}
		}
		return -1;
	}

	this.addFilter = function(name,fn,type) {
		//name is optional
		if (typeof name==='function') {
			type = fn;
			fn = name;
			name = null;
		}
		//force a unique, valid name
		if (!name || !/^[a-z][\w-]*$/i.test(name) || getFilterIndexByName(name)>=0) {
			do {
				name = 'filter' + guid();
			} while(getFilterIndexByName(name)>=0);
		}
		//if this is not the first filter added
		if (filters.length) {
			$container.classList.remove('filters-'+filters.length);
		}
		var filter = { name: name };
		if (typeof fn==='function') {
			//default type is pixel if not defined
			filter.type = 'full' === type ? type : 'pixel';
			filter.fn = fn;
		} else {
			filter.type = 'none';
		}
		filters.push(filter);
		$container.classList.add('filters-'+filters.length);
		return this;
	}

	// set the current filter by index num or filter name
	this.setFilter = function(which) {
		// find filter by index number or name
		if (which!==selectedFilter && (filters[which] || (typeof which==='string' && (which = getFilterIndexByName(which))>=0)) ) {
			// do we even have a filter set yet?
			if (typeof selectedFilter!=='undefined') {
				//remove previous filter classes
				$container.classList.remove('filter-'+selectedFilter,'filter-'+filters[selectedFilter].name);
				this.trigger('filterchange',[filters[selectedFilter],filters[which]]);
			}
			selectedFilter = which;
			//add new filter classes
			$container.classList.add('filter-'+selectedFilter,'filter-'+filters[selectedFilter].name);
		}
		return this;
	}

	this.currentFilter = function() {
		return selectedFilter;
	}

	this.currentFilterName = function() {
		return filters[selectedFilter].name;
	}

	// advance the selected filter
	this.scrollFilter = function(howMany) {
		// scroll forward 1 if not specified
		howMany = typeof howMany==='undefined' ? 1 : (parseInt(howMany) || 0);
		if (howMany<0) {
			howMany = filters.length - (Math.abs(howMany) % filters.length);
		}
		this.setFilter((selectedFilter + howMany) % filters.length);
		return this;
	}

	// constructor that runs only once body is ready
	var init = function() {
		options = options || {};
		// these options can be passed as an array or a function that returns an array
		var arrayOrFn = ['imageSize', 'canvasSize'];
		for (var i=0; i<arrayOrFn.length; i++) {
			if (Array.isArray(options[ arrayOrFn[i] ])) {
				//if it was an array, convert it to a function that returns a copy of that array
				options[ arrayOrFn[i] ] = returnThis( options[ arrayOrFn[i] ].slice() );
			}
		}
		// if position is an array of coordinates
		if (Array.isArray(options.position)) {
			var coords = options.position.slice();
			options.position = function(num) {
				return coords[ Math.min(num,coords.length)-1 ];
			}
		}
		//set up the initially passed options
		this.setOption(options);
		// global container that receives different classes for various states
		$container = options.container instanceof HTMLElement ? options.container : document.body;
		// add preview canvas element
		(options.previewContainer instanceof HTMLElement ? options.previewContainer : $container).appendChild($preview);
		//pluck out event handlers from options
		for (key in options) {
			if (options.hasOwnProperty(key) && key.substr(0,2)==='on' && typeof options[key]==='function') {
				this.on(key.substr(2).toLowerCase(),options[key]);
			}
		}
		// set the filters
		options.filters = Array.isArray(options.filters) ? options.filters : Object.keys(PB.filters);
		for (var i=0; i<options.filters.length; i++) {
			var filter = options.filters[i];
			//set a default filter
			if (typeof filter==='string' && Object.keys(PB.filters).indexOf(filter)>=0) {
				this.addFilter(filter,PB.filters[filter]);
			} else if (typeof filter==='object') {
				this.addFilter(filter.name,filter.fn,filter.type);
			} else if (typeof filter==='function') {
				// assumed default filter type and given a unique name
				this.addFilter(filter);
			}
		}
		// lock in the default filter
		this.setFilter(0);
		// set the state as stopped
		$container.classList.add('stopped','photobooth');
		this.requestVideo();
	}

	// init when body is ready
	bodyReady(init.bind(this));

}

//flash 'em!
var $flash = document.createElement('div');
// [flash duration in ms], fade duration in ms, [callback function]
PB.flash = function(flash,fade,fn) {
	//flash length is optional, so shift the vars if necessary
	if (arguments.length<3) {
		fn = fade;
		fade = flash;
	}
	//do not try to flash if fade duration is not > 0
	if ((fade = Math.floor(fade))<0 || !fade) return;
	flash = Math.floor(Math.abs(flash));
	if (typeof fn==='function') {
		//temporary wrapper to call the callback function once when the transition ends and then remove itself
		var wrapFn = function() {
			fn.call(this);
			$flash.removeEventListener('transitionend',wrapFn);
		}
		$flash.addEventListener('transitionend',wrapFn);
	}
	$flash.style.opacity = 1;
	$flash.style.display = 'block';
	$flash.style.transitionProperty = 'opacity';
	$flash.style.transitionDelay = flash ? flash + 'ms' : '0';
	$flash.style.transitionDuration = fade + 'ms';
	//request a repaint to lock in the initial styles
	$flash.offsetHeight;
	//fade into darkness
	$flash.style.opacity = 0;
}

var $canvas = document.createElement('canvas')
	, canvasContext = $canvas.getContext('2d')
;
PB.imgDataToURL = function(imgData,type,quality) {

}

// default filter functions
PB.filters = {
	normal: null,
	greyscale: function(r,g,b,a) {
		var avg = 0.34 * r + 0.5 * g + 0.16 * b;
		return [avg,avg,avg,a];
	},
	sepia: function(r,g,b,a) {
		var avg = 0.34 * r + 0.5 * g + 0.16 * b;
		return [avg + 100, avg + 50, avg, a];
	},
	negative: function(r,g,b,a) {
		return [255 - r, 255 - g, 255 - b, a];
	},
	colorswap: function(r,g,b,a) {
		return [g, b, r, a];
	},
}

PB.utilities = {
	// draw an image onto a canvas rotated around a point
	drawImageRotatedCenter: function(context,img,x,y,angle,width,height) {
		width = width || img.width;
		height = height || img.height;
		angle = angle || 0;

		// save the current state of the transformations
		context.save();

		// move to the center of where the drawing will go
		context.translate(x, y);
		context.rotate(angle * TO_RADIANS);

		// draw the image offset backwards by half the width & height
		context.drawImage(img, width/-2, height/-2);

		// bring back the old set
		context.restore();
	},
}

PB.render = {
	// generic rendering helper methods
	generic: {
		// img is passed as an HTMLImage element, num starts from 1
		processImage: function(img,num) {
			//rotate the image in portrait mode
			if (this.isPortrait()) {
				console.log('portrait!');
				//clear canvas and match to the width/height of the image after rotation
				this.canvas.reset(this.getHeight(), this.getWidth());
				//apply necessary transformations to get the desired rotation
				switch (this.getOption('orientation')) {
					case 'portrait-cc':
						this.canvas.context.rotate(90*TO_RADIANS);
						this.canvas.context.translate(0, -this.getHeight());
					break;

					case 'portrait':
						this.canvas.context.rotate(-90*TO_RADIANS);
						this.canvas.context.translate(-this.getWidth(), 0);
					break;
				}
				//stick the image onto the canvas
				this.canvas.context.drawImage(img,0,0);
				//pull out the image after rotation and replace the source
				img.src = this.canvas.el.toDataURL();
			}
			return img;
		},
		// method that returns the destination size for a given image by num starting from 1
		imageSize: function(num) {
			return this.isPortrait() ? [ this.getHeight(), this.getWidth() ] : [ this.getWidth(), this.getHeight() ];
		},
	},

	// helper methods for positioning images in a grid when rendering the strip
	grid: {
		// function that returns the position for a given image num, starting from 1
		position: function(num) {
			var across = Math.max(this.getOption('across')||0,1)
				, size = this.getOption('imageSize').call(this)
				, outer = this.getOption('outer')
				, inner = this.getOption('inner')
			;
			return [outer + (num-(Math.ceil(num/across)-1)*across-1)*(inner+size[0]), outer + (Math.ceil(num/across)-1)*(inner+size[1])];
		},
		// function that returns the canvas size
		canvasSize: function() {
			var across = Math.max(this.getOption('across')||0,1)
				, down = Math.ceil(this.getOption('shots') / across)
				, size = this.getOption('imageSize').call(this)
				, outer = this.getOption('outer')
				, inner = this.getOption('inner')
			;
			//calculate the width/height of the canvas based on number of shots, spacing, and placement
			return [size[0]*across + outer*2 + (across-1)*inner, size[1]*down + outer*2 + (down-1)*inner];
		},
	},
}
// set the grid helper functions as the defaults
defaults.processImage = PB.render.generic.processImage;
defaults.imageSize = PB.render.generic.imageSize;
defaults.position = PB.render.grid.position;
defaults.canvasSize = PB.render.grid.canvasSize;

// redefine a default option value / add an new allowed option
PB.setDefault = function(key,defaultVal) {
	defaults[key] = defaultVal;
}

PB.getDefault = function(key) {
	return defaults[key];
}

//stuff that relies on the DOM being ready
bodyReady(function(){
	//set up the flash element
	$flash.classList.add('photo-flash','custom');
	document.body.appendChild($flash);
	$flash.addEventListener('transitionend', function(ev) {
		$flash.style.display = 'none';
		$flash.style.transitionProperty = 'none';
	});
});

}(window,document));