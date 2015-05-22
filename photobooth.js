
;(function(window) {

var defaults = {
		orientation: 'portrait', // or landscape
		refreshRate: 33, //ms to repaint canvas
		shots: 4, // number of shots to take
		shotDelay: 4000, //ms between shots
		nofilter: true, //hashtag nofilter (allow true color as a filter option)
		imageType: 'image/jpeg',
		flashDur: 0, //duration of flash
		flashFade: 300, //duration of flash fadeout...0 disables the flash
		print: false,
		resolution: [320, 240], // [640, 480]
		previewQuality: 1, //percentage quality (of main resolution) for the preview video
		runningRate: 100, //ms to run the runner
		//events, e.g. on____
		//
	}
	, PhotoBoothException = function(msg) {
		this.message = msg;
		this.name = 'PhotoBoothException';
	}
	, URL = window.URL || window.webkitURL
	, guid = 0
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
		, selectedFilter = 0
		, $container //overall container to apply status classes to
		, intervalID // setInterval ID for when the sequence is running
		, $preview = document.createElement('canvas')
		, previewContext = $preview.getContext('2d')
		, $snap = document.createElement('canvas')
		, snapContext = $snap.getContext('2d')
		, refreshID
		, $video = document.createElement('video')
		, isStreaming = false
		, isSnapping = false
		, width //lock in these values for consistency
		, height
		, previewWidth
		, previewHeight
		, timerVal
		, snaps = []
	;

	// can we even get the video feed?
	if (typeof navigator.getUserMedia!=='function') {
		throw new PhotoBoothException('getUserMedia is not supported in this browser.');
	}

	// repaint the preview canvas
	var repaint = function() {
		if ($video.paused || $video.ended) {
			streamEnded();
			return;
		}
		previewContext.drawImage($video, 0, 0, previewWidth, previewHeight);
		var img = previewContext.getImageData(0, 0, previewWidth, previewHeight);
		// loop on the pixels
		for (var i = 0; i < img.data.length; i += 4) {
			//pass the pixel components (r,g,b,a) through the pixel filter
			var newPixel = filters[selectedFilter].fn(img.data[i],img.data[i+1],img.data[i+2],img.data[i+3]);
			img.data[i] = newPixel[0];
			img.data[i+1] = newPixel[1];
			img.data[i+2] = newPixel[2];
			img.data[i+3] = newPixel[3];
		}
		previewContext.putImageData(img, 0, 0);
	}

	// clean up after the stream has stopped
	var streamEnded = function() {
		if (isStreaming) {
			self.trigger('videoended');
			clearInterval(refreshID);
			$container.classList.add('video-off');
			$container.classList.remove('video-on');
			isStreaming = false;
		}
	}

	this.requestVideo = function() {
		navigator.getUserMedia({ video: true, audio: false },
			// success! we have a stream
			function(stream) {
				// make the stream reference publicly available
				self.stream = stream;
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
						// Reverse the canvas image
						previewContext.translate(previewWidth, 0);
						previewContext.scale(-1, 1);
						snapContext.translate(width, 0);
						snapContext.scale(-1, 1);
						isStreaming = true;
					}
				});
				$video.addEventListener('play', function() {
					self.trigger('videostarted');
					$container.classList.add('video-on');
					$container.classList.remove('video-off');
					refreshID = setInterval(repaint, self.getOption('refreshRate'));
				});
				$video.addEventListener('ended', streamEnded);
				$video.play();
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

	this.getOption = function(option) {
		return typeof settings[option]==='undefined' ? defaults[option] : settings[option];
	}

	this.on = function(type,handler) {
		events[type] = events[type] || [];
		events[type].push(handler);
		return this;
	}

	this.trigger = function(type,context,args) {
		var returnVal = true;
		if (!Array.isArray(events[type])) return this;
		if (arguments.length<3) {
			args = context;
		}
		context = context || this;
		args = Array.isArray(args) ? args : [];
		//add the PhotoBooth object as first arg always
		args.unshift(this);
		for(var i=0; i<events[type].length; i++) {
			returnVal = events[type][i].apply(context,args)===false ? false : returnVal;
		}
		return returnVal;
	}

	this.start = function() {
		$container.classList.add('started');
		$container.classList.remove('paused','stopped');
		if (!isSnapping) {
			snaps = [];
		}
	}

	this.pause = function() {
		$container.classList.add('paused');
		clearInterval(intervalID);
	}

	this.stop = function() {
		$container.classList.add('stopped');
		$container.classList.remove('paused','started');
		isSnapping = false;
		clearInterval(intervalID);
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

	this.addFilter = function(name,fn) {
		//check for name validity and that it is not in use
		if (/^[a-z][\w-]*$/i.test(name) && getFilterIndexByName(name)===-1 && typeof fn==='function') {
			filters.push({
				name: name,
				fn: fn
			});
		}
		return this;
	}

	this.setFilter = function(which) {
		// find filter by index number or name
		if (which!==selectedFilter && (filters[which] || (typeof which==='string' && (which = getFilterIndexByName(which))>=0)) ) {
			//remove previous filter classes
			$container.classList.remove('filter-'+selectedFilter,'filter-'+filters[selectedFilter].name);
			selectedFilter = which;
			//add new filter classes
			$container.classList.add('filter-'+selectedFilter,'filter-'+filters[selectedFilter].name);
			this.trigger('filterchange');
		}
		return this;
	}

	this.currentFilter = function() {
		return selectedFilter;
	}

	this.currentFilterName = function() {
		return filters[selectedFilter].name;
	}

	this.scrollFilter = function(howMany) {
		howMany = typeof howMany==='undefined' ? 1 : (parseInt(howMany) || 0);
		if (howMany<0) {
			howMany = filters.length + howMany;
		}
		this.setFilter((selectedFilter + howMany) % filters.length);
		return this;
	}

	options = options || {};
	//set up the initially passed options
	this.setOption(options);
	//pluck out event handlers from options
	for (key in options) {
		if (options.hasOwnProperty(key) && key.substr(0,2)==='on' && typeof options[key]==='function') {
			this.on(key.substr(2).toLowerCase(),options[key]);
		}
	}
	// set the filters
	options.filters = Array.isArray(options.filters) ? options.filters : Object.keys(PB.filters);
	for (var i=0; i<options.filters.length; i++) {
		//set a default filter
		if (typeof options.filters[i]==='string' && Object.keys(PB.filters).indexOf(options.filters[i])>=0) {
			this.addFilter(options.filters[i],PB.filters[options.filters[i]]);
		}
	}
	// global container that receives different classes for various states
	$container = options.container instanceof HTMLElement ? options.container : document.body;
	// preview canvas element
	(options.previewContainer instanceof HTMLElement ? options.previewContainer : $container).appendChild($preview);
	this.requestVideo();

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

// default filter functions
PB.filters = {
	normal: function() {
		return arguments;
	},
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