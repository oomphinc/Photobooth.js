/**
 * TODO
 * - use requestAnimationFrame or fallback to setInterval
 */

;(function(window) {

var defaults = {
		orientation: 'landscape', // or portrait
		refreshRate: 33, //ms to repaint canvas
		shots: 4, // number of shots to take
		shotDelay: 4000, //ms between shots
		imageType: 'image/jpeg',
		flashDur: 200, //duration of flash
		flashFade: 300, //duration of flash fadeout...0 disables the flash
		print: false,
		resolution: [320, 240], // [640, 480]
		previewQuality: 1, //percentage quality (of main resolution) for the preview video
		tickRate: 100, //ms to run the runner
		mirror: true, //mirror the video preview?
		//events, e.g. on____
		//
	}
	, PhotoBoothException = function(msg) {
		this.message = msg;
		this.name = 'PhotoBoothException';
		this.toString = function() {
			return this.name + ': ' + this.message;
		}
	}
	, URL = window.URL || window.webkitURL //smooth out vender prefix
	, guid = (function(){
		var counter = 0;
		return function() {
			return ++counter;
		}
	})()
;

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
		, refreshID // setInterval ID for repainting the canvas
		, $video = document.createElement('video')
		, isStreaming = false //whether video stream is active
		, isSnapping = false //whether a session is underway
		, width //lock in these values for consistency
		, height
		, previewWidth
		, previewHeight
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
		var img = previewContext.getImageData(0, 0, previewWidth, previewHeight);
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
						// constrain within 0 to 1
						var qual = Math.min(Math.max(self.getOption('previewQuality'),0),1) || 1;
						width = res[0];
						height = res[1];
						// videoWidth isn't always set correctly in all browsers
						if ($video.videoWidth > 0) height = $video.videoHeight / ($video.videoWidth / width);
						previewWidth = width * qual;
						previewHeight = height * qual;
						$preview.setAttribute('width', previewWidth);
						$preview.setAttribute('height', previewHeight);
						$snap.setAttribute('width', width);
						$snap.setAttribute('height', height);
						// Reverse the canvas image if mirror enabled
						if (self.getOption('mirror')) {
							previewContext.translate(previewWidth, 0);
							previewContext.scale(-1, 1);
						}
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

	// using the container element, check if a status class is present
	this.is = function(what) {
		return $container.classList.contains(what);
	}

	// attach a handler to an event
	this.on = function(type,handler) {
		events[type] = events[type] || [];
		events[type].push(handler);
		return this;
	}

	// trigger an event -- context is optional, defaults to this PhotoBooth object
	this.trigger = function(type,context,args) {
		var returnVal = true;
		if (!Array.isArray(events[type])) return this;
		if (arguments.length<3) {
			args = context;
			context = false;
		}
		context = context || this;
		args = Array.isArray(args) ? args : [];
		for(var i=0; i<events[type].length; i++) {
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
				self.stop();
			}
		}
	}

	// take a snapshot and save!
	var snap = function() {
		self.trigger('snap',[snaps.length+1]);
		PB.flash(self.getOption('flashDur'), self.getOption('flashFade'), function(){
			self.trigger('flashend');
		});
		// no-op the snap saving for now
		snaps.push(1);
	}

	// capture current image from video feed
	this.captureFrame = function() {
		snapContext.drawImage($video, 0, 0, width, height);
		return snapContext.getImageData(0, 0, width, height);
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

	this.kill = function() {
		clearInterval(refreshID);
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
		$container.classList.add('stopped');
		this.requestVideo();
	}

	// check to see that the body exists!
	if (document.body) {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init.bind(this));
	}

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

//stuff that relies on the DOM being ready
document.addEventListener('DOMContentLoaded', function(){
	//set up the flash element
	$flash.classList.add('photo-flash','custom');
	document.body.appendChild($flash);
	$flash.addEventListener('transitionend', function(ev) {
		$flash.style.display = 'none';
		$flash.style.transitionProperty = 'none';
	});
});

}(window));