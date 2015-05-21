
;(function(window) {

var defaults = {
		orientation: 'portrait', // or landscape
		refreshRate: 33, //ms to repaint canvas
		shots: 4, // number of shots to take
		shotDelay: 4, //secs between shots
		nofilter: true, //hashtag nofilter
		imageType: 'image/jpeg',
		flashFade: 300, //duration of flash fadeout
		//events, e.g. on____
	}
	, filters = {
		greyscale: function() {

		},
		sepia: function() {

		},
	}
	, $flash = document.createElement('div')
	, $ = function() {

	}
	, $style = document.createElement('style')
;

// add some styles for the flash
$style.type = 'text/css';
$style.innerHTML = '.photo-flash { background-color: white; position: fixed; top: 0px; left: 0px; bottom: 0px; right: 0px; z-index: 999; display: none; }';
document.getElementsByTagName('head')[0].appendChild($style);

var PB = window.PhotoBooth = function(options) {
	var settings = {}
		, events = {}
		, filters = {}
	;

	this.setOption = function(option,value) {
		var allowed = Object.keys(defaults);
		if (typeof option==='object') {
			for (key in option) {
				if (option.hasOwnProperty(key)) {
					this.setOption(key,option[key]);
				}
			}
		} else if (allowed.indexOf(option)>=0) {
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
		if (!Array.isArray(events[type])) return this;
		context = context || this;
		args = Array.isArray(args) ? args : [];
		for(var i=0; i<events[type].length; i++) {
			events[type][i].apply(context,args);
		}
		return this;
	}

	//set up the initially passed options
	this.setOption(options);
	//pluck out event handlers from options
	for (key in options) {
		if (options.hasOwnProperty(key) && key.substr(0,2)==='on' && typeof options[key]==='function') {
			this.on(key.substr(2).toLowerCase(),options[key]);
		}
	}

}

//flash 'em!
PB.flash = function(dur) {
	// set up the flash, once
	if (!$flash.classList.contains('photo-flash')) {
		$flash.classList.add('photo-flash');
		document.getElementsByTagName('body')[0].appendChild($flash);
		$flash.addEventListener('transitionend', function(ev) {
			$flash.style.display = 'none';
			$flash.style.transitionProperty = 'none';
		}, false);
	}
	$flash.style.opacity = 1;
	$flash.style.display = 'block';
	$flash.style.transitionProperty = 'opacity';
	$flash.style.transitionDuration = (parseInt(dur)||0) + 'ms';
	//request a repaint to lock in the initial styles
	$flash.offsetHeight;
	//fade into darkness
	$flash.style.opacity = 0;
}

}(window));