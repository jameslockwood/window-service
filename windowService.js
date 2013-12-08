(function( context ){

	var _domain = 'http://' + window.location.host;
	var _messageHandlers = [];
	var _childMessageHandlers = [];
	var _childMessageSubjectHandlers = [];
	var _windowUnloadHandlers = [];
	var _parentWindowIdentifier = '__ParentWindow__';
	var _parentKeyReference = '__ParentWindowKeyReference__';
	var _initialisedSubject = '__windowInitialised__';

	function getParentWindow(){
		return window[_parentWindowIdentifier];
	}

	var _childWindowCollection = (function(){

		var _dict = {};
		var _onLoad = {};
		var _key = 0;

		return {
			registerWindow : function( childWindow ){
				_key++;
				_keyReference = _key / 1;
				_dict[ _keyReference ] = childWindow;

				return {
					getKey : function(){
						return _keyReference;
					},
					registerOnLoadHandlers : function( callbackArray ){
						_onLoad[ _keyReference ] = callbackArray;
					}
				};
			},
			removeWindowReference : function( key ){
				delete _dict[ key ];
				delete _onLoad[ _keyReference ];
			},
			registerWindowInitilisation : function( key ){
				var childWindow = this.getWindow( key );
				var handlers = this.getWindowOnLoadHandlers( key );
				for( var i in handlers ){
					handlers[i].call( null, childWindow );
				}
			},
			getWindow : function( key ){
				return _dict[ key ];
			},
			getWindowOnLoadHandlers : function( key ){
				return _onLoad[ key ];
			}

		};

	})();

	// handles post messages sent to THIS window
	window.addEventListener('message', function( message ) {

		var subject = message.data.subject;
		var data = message.data.data;
		var key = message.data.key;
		var origin = message.origin;
		var sourceWindow = message.source;

		// ignore the message if it does not originate from the same domain
		if( origin !== _domain ){
			return;
		}

		// check if it's a child window initialise message
		if( subject === _initialisedSubject ){
			return onChildWindowInitialised( data );
		}

		// invoke any generic message handlers
		for ( var i in _messageHandlers ) {
			var handler = _messageHandlers[i];
			if ( handler.subject === subject ) {
				handler.callback( data, subject, sourceWindow, key );
			}
		}

		// invoke any messages handlers specific to child windows
		for ( var j in _childMessageHandlers ) {
			var childHandler = _childMessageHandlers[j];
			if( childHandler.source !== sourceWindow ){
				continue;
			}
			childHandler.callback( data, subject, sourceWindow, key );
		}

		// invoke any messages handlers specific to child windows with particular subjects
		for ( var k in _childMessageSubjectHandlers ) {
			var childSubjectHandler = _childMessageSubjectHandlers[k];
			if( childSubjectHandler.source !== sourceWindow ){
				continue;
			}
			if ( childSubjectHandler.subject === subject ) {
				childSubjectHandler.callback( data, subject, sourceWindow, key );
			}
		}

	});

	function resolveWindowObject( childWindow ){
		if( childWindow instanceof Window ){
			return childWindow
		}
		if( typeof childWindow.getWindow === 'function' ){
			return childWindow.getWindow();
		}
		throw new Error('Could not resolve the window object');
	}

	// adds message handlers to any messages that this window recives
	function onMessage( subject, fn, context ){
		if( typeof subject !== 'string' ){  throw new Error('Subject must be a string'); }
		if( typeof fn !== 'function' ){       throw new Error('Message handler must be a function'); }
		var callback = function( data, subject, sourceWindow, key ) {
			fn.call(context || null, data, sourceWindow );
		};
		_messageHandlers.push({
			subject: subject,
			callback: callback
		});
	}

	// adds message handlers to messages from a particular window
	function whenMessagedBy( childWindow, fn, context ){
		if( !childWindow ){          throw new Error('Expected a child window'); }
		if( arguments.length === 1 ){
			return {
				withSubject : function( subject, handler, context ){
					whenMessagedByWindowWithSubject( childWindow, subject, handler, context );
				}
			};
		}

		if( typeof fn !== 'function' ){       throw new Error('Message handler must be a function'); }
		var callback = function( data, subject, sourceWindow, key ) {
			fn.call(context || null, subject, data, sourceWindow );
		};

		_childMessageHandlers.push({
			source : resolveWindowObject( childWindow ),
			callback: callback
		});
	}


	// adds message handlers to messages from a particular window with a particular subject
	function whenMessagedByWindowWithSubject( childWindow, subject, fn, context ){
		if( !childWindow ){          throw new Error('Expected a child window'); }
		if( typeof subject !== 'string' ){  throw new Error('Subject must be a string'); }
		if( typeof fn !== 'function' ){       throw new Error('Message handler must be a function'); }

		var callback = function( data, subject, sourceWindow, key ) {
			fn.call(context || null, data, sourceWindow );
		};

		_childMessageSubjectHandlers.push({
			source : resolveWindowObject( childWindow ),
			subject : subject,
			callback: callback
		});
	}

	// adds observers to the event that's fired when this window closes
	function onParentWindowClose( fn ){
		_windowUnloadHandlers.push( fn );
	}

	// now add the hook to notify all observers when this window closes
	var _previousWindowUnloadHandle = ( typeof window.onbeforeunload === 'function' ? window.onbeforeunload : function(){} );
	window.onbeforeunload = function(){
		for( var i in _windowUnloadHandlers ){
			try {
				_windowUnloadHandlers[i].call( null, window );
			} catch( e ){}
		}
		_previousWindowUnloadHandle();
	};

	// strategy for sending a message to an unspecified window
	function messageWindow( windowObject, subject, data ){
		if( typeof subject !== 'string' ){  throw new Error('Subject must be a string'); }
		if( windowObject ){
			windowObject.postMessage(
				{ subject : subject, data : data },
				_domain
			);
		}
	}

	// strategy to send message to parent window
	function messageParentWindow( subject, data ){
		return messageWindow( getParentWindow(), subject, data );
	}

	function onChildWindowInitialised( key ){
		_childWindowCollection.registerWindowInitilisation( key );
	}

	// try message the parent to say that we've initialised
	setTimeout( function(){
		messageParentWindow( _initialisedSubject, window[ _parentKeyReference ] );
	}, 10);

	// our exposed interface below
	context.windowService = {

		// creates a child window - returns a childWindow interface
		createWindow : function( options ){

			if( !options ){     throw new Error('Options object must be provided.'); }
			if( !options.url ){               throw new Error('Expected a url'); }

			var childWindowReadyHandlers = [];
			var childWindowUnloadHandlers = [];
			var childWindowHasLoaded = false;
			var childWindowIsOpen = true;
			var closeChildWindowWhenParentCloses = options.closeWithParent || true;
			var childWindow;
			var childWindowKey;

			var url = options.url;
			var target = options.target || '_blank';
			var windowOptions = {
				'left' : 24,
				'top' : 24,
				'menubar' : 'no',
				'toolbar' : 'no',
				'location' : 0,
				'resizable' : 'yes',
				'scrollbars' : 'yes',
				'status' : 'no',
				'height' : options.height || window.innerHeight - 10,
				'width' : options.width || window.innerWidth - 200,
				'dependent' : 'yes',
				'dialog' : 'no',
				'chrome' : 'no',
				'alwaysRaised' :'yes'
			};

			// convert our windows options into a string that the browser understands
			var windowOptionsString = '';

			for( var i in windowOptions ){
				var prefix = ( windowOptionsString.length  ? ',' : '' );
				windowOptionsString += ( prefix + i + '=' + windowOptions[i].toString() );
			}

			childWindow = window.open( url, target, windowOptionsString );

			var registeredWindow = _childWindowCollection.registerWindow( childWindow );
			registeredWindow.registerOnLoadHandlers( childWindowReadyHandlers );
			childWindowKey = registeredWindow.getKey();

			// add reference to parent window
			childWindow[_parentWindowIdentifier] = window;
			childWindow[_parentKeyReference] = childWindowKey;

			// strategy to send a message to the child window
			function messageChildWindow( subject, data ){
				return messageWindow( childWindow, subject, data );
			}

			// strategy to observe when child window has loaded
			function onChildWindowReady( callback ){
				childWindowReadyHandlers.push( function(){
					callback.call( null, childWindow );
				});
			}

			// inform THIS (parent) window if the child window closes
			var _previousChildWindowUnloadHandle = ( typeof childWindow.onbeforeunload === 'function' ? childWindow.onbeforeunload : function(){} );
			childWindow.onbeforeunload = function(){
				for( var i in childWindowUnloadHandlers ){
					try {
						childWindowUnloadHandlers[i].call( null, childWindow );
					} catch( e ){}
				}
				_previousChildWindowUnloadHandle();
			};

			// strategy to observe when the child window closes
			function onChildWindowClose( fn ){
				childWindowUnloadHandlers.push( fn );
			}

			// inform the child window if THIS (parent) window closes
			onParentWindowClose( function( parentWindow ){
				messageChildWindow('parentWindowClose');
				if( closeChildWindowWhenParentCloses ){
					childWindow.close();
				}
			});

			onChildWindowClose( function(){
				// indicate to consumers that the child window is now closed
				childWindowIsOpen = false;
				// remove the window reference from memory
				_childWindowCollection.removeWindowReference( childWindowKey );
			});

			// allows service to indicate if child window has loaded
			onChildWindowReady( function(){
				childWindowHasLoaded = true;
			});

			// childWindow interface
			return {

				// returns the child window
				getWindow : function(){
					return childWindow;
				},


				// performs a callback once the window has loaded
				then : function( fn ){
					var root = this;
					if( this.hasLoaded() ){
						fn.call( null, root );
					} else {
						onChildWindowReady( function(){
							fn.call( null, root );
						});
					}
					return this;
				},

				// sends a message to the child window
				message : messageChildWindow,

				// indicates if the child window is open
				isOpen : function(){
					return childWindowIsOpen;
				},

				// indicates if the child window has loaded
				hasLoaded : function(){
					return childWindowHasLoaded;
				},

				// observe when the child window closes
				onClose : onChildWindowClose,

				// closes the child window
				close : function(){
					childWindow.close();
				},

				// keeps the child window open in the event of the parent window closing
				keepOpen : function(){
					closeChildWindowWhenParentCloses = false;
				},

				// gain focus
				focus : function(){
					this.getWindow().focus();
				}

			};

		},

		// observes when messages are received
		onMessage : onMessage,

		// observes when messages are received from a particular window
		whenMessagedBy : whenMessagedBy,

		// indicates if THIS window is a child
		isChildWindow : function(){
			return !!getParentWindow();
		},

		// sends a message to the parent window
		messageParent : messageParentWindow

	};

})( this );
