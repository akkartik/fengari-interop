"use strict";

const {
	lua: {
		LUA_OK,
		LUA_ERRRUN,
		lua_pcall,
		lua_pop,
		lua_pushvalue,
		lua_tojsstring
	},
	lauxlib: {
		luaL_dostring,
		luaL_loadstring,
		luaL_newstate,
		luaL_requiref
	},
	lualib: {
		luaL_openlibs
	},
	to_luastring
} = require("fengari");

describe("fengari-interop", function() {
	const { luaopen_js, push, tojs } = require("../src/js.js");
	const new_state = function() {
		const L = luaL_newstate();
		luaL_openlibs(L);
		luaL_requiref(L, to_luastring("js"), luaopen_js, 0);
		return L;
	};

	it("loads successfully", function() {
		expect(typeof luaopen_js).toBe("function");
	});

	it("can be required from lua", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring('require("js")')) !== LUA_OK) {
			throw lua_tojsstring(L, -1);
		}
	});

	it("pushes same null every time", function() {
		const L = new_state();
		if (luaL_loadstring(L, to_luastring(`
		local null = ...
		local js = require "js"
		assert(null == js.null)
		assert(rawequal(null, js.null))
		`)) !== LUA_OK) {
			throw lua_tojsstring(L, -1);
		}
		push(L, null);
		if (lua_pcall(L, 1, 0, 0) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("test all types js -> lua", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		assert(rawequal(js.global:eval('void 0'), nil), "undefined not equal")
		assert(rawequal(js.global:eval('1'), 1.0), "numbers not equal")
		assert(rawequal(js.global:eval('"foo"'), "foo"), "strings not equal")
		assert(rawequal(js.global:eval('true'), true), "booleans not equal")
		assert(rawequal(js.global:eval('null'), js.null), "null not equal")
		assert(type(js.global:eval('({})')) == "userdata", "object type not userdata")
		assert(type(js.global:eval('(function(){})')) == "userdata", "function type not userdata")
		assert(type(js.global:eval('Symbol("test")')) == "userdata", "Symbol type not userdata")
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("test all types lua -> js", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		assert(js.global:Function('"use strict"; return this === void 0')(nil), "undefined not equal")
		assert(js.global:Function('"use strict"; return this === 1')(1.0), "numbers not equal")
		assert(js.global:Function('"use strict"; return this === "foo"')("foo"), "strings not equal")
		assert(js.global:Function('"use strict"; return this === true')(true), "booleans not equal")
		assert(js.global:Function('"use strict"; return this === null')(js.null), "null not equal")
		assert(js.global:Function('"use strict"; return typeof this === "function"')(function() end), "function type not userdata")
		assert(js.global:Function('"use strict"; return typeof this === "function"')(js.createproxy(function() end, "function")), "function proxy type not function")
		assert(js.global:Function('"use strict"; return typeof this === "object"')(js.createproxy({}, "object")), "object proxy type not object")
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("can round trip lua->js->lua", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		local myfunc = function() end -- something that takes proxy path
		js.global.foo = myfunc
		assert(rawequal(myfunc, js.global.foo))
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("allows calls with no 'this' or arguments", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		js.global.Date.now()
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("tostring on js objects", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		assert(tostring(js.null) == "null")
		assert(tostring(js.new(js.global.Object)) == "[object Object]")
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("js.new works for #args 0..5", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		local a = js.new(js.global.Array)
		assert(a.length == 0)
		-- Array constructor does different things with single integer argument, use something else
		local a = js.new(js.global.Array, {})
		assert(a.length == 1)
		local a = js.new(js.global.Array, 1, 2)
		assert(a.length == 2)
		local a = js.new(js.global.Array, 1, 2, 3)
		assert(a.length == 3)
		local a = js.new(js.global.Array, 1, 2, 3, 4)
		assert(a.length == 4)
		local a = js.new(js.global.Array, 1, 2, 3, 4, 5)
		assert(a.length == 5)
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("attaches __len to typed arrays", function() {
		let a = new Uint16Array(1);
		if (a[Symbol.for("__len")] === void 0)
			throw Error("missing __len");
	});

	it("__len on typed arrays works", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		local a = js.new(js.global.Uint8Array, 10)
		assert(#a == 10)
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("missing __len fails", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		local a = js.new(js.global.Object)
		local ok, err = pcall(function() return #a end)
		assert(not ok, "succeeded when should have failed")
		assert(err:match("js object has no __len Symbol"), "wrong error")
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("allows iterating over objects with pairs()", function() {
		const L = new_state();
		if (luaL_dostring(L, to_luastring(`
		local js = require "js"
		local o = js.new(js.global.Object)
		o.foo = "foo"
		o.bar = "bar"
		local seen = {}
		local n_seen = 0
		for k, v in pairs(o) do
			seen[k] = v
			n_seen = n_seen + 1
		end
		assert(seen.foo == "foo")
		assert(seen.bar == "bar")
		assert(n_seen == 2)
		`)) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("well formed custom __pairs", function() {
		const L = new_state();
		if (luaL_loadstring(L, to_luastring(`
		local o = ...
		local js = require "js"
		local f, s, l = pairs(o)
		assert(s == js.null, "state incorrect")
		assert(l == nil, "initial incorrect")
		local x
		l, x = f(s, l)
		assert(l == 1, "incorrect 1st key")
		assert(x == "one", "incorrect 1st value")
		l, x = f(s, l)
		assert(l == 2, "incorrect 2nd key")
		assert(x == "two", "incorrect 2nd value")
		l, x = f(s, l)
		assert(l == nil, "expected end")
		`)) !== LUA_OK) {
			throw lua_tojsstring(L, -1);
		}
		push(L, {
			[Symbol.for("__pairs")]: function() {
				return {
					iter: function(last) {
						if (last === void 0) {
							return [1, "one"];
						} else if (last && last === 1) {
							return [2, "two"];
						} else {
							return void 0;
						}
					},
					state: null
				}
			}
		});
		if (lua_pcall(L, 1, 0, 0) !== LUA_OK) {
			throw tojs(L, -1);
		}
	});

	it("catches badly formed custom __pairs", function() {
		const L = new_state();
		if (luaL_loadstring(L, to_luastring(`
		local o = ...
		local js = require "js"
		for k, v in pairs(o) do
		end
		`)) !== LUA_OK) {
			throw lua_tojsstring(L, -1);
		}

		lua_pushvalue(L, -1);
		push(L, Object.create(null));
		expect(lua_pcall(L, 1, 0, 0)).toBe(LUA_ERRRUN);
		expect(tojs(L, -1)).toEqual(expect.stringContaining("js object has no __pairs Symbol"));
		lua_pop(L, 1);

		lua_pushvalue(L, -1);
		push(L, {
			[Symbol.for("__pairs")]: function() {}
		});
		expect(lua_pcall(L, 1, 0, 0)).toBe(LUA_ERRRUN);
		expect(tojs(L, -1)).toEqual(expect.stringContaining("bad '__pairs' result"));
		lua_pop(L, 1);

		lua_pushvalue(L, -1);
		push(L, {
			[Symbol.for("__pairs")]: function() {
				return {}
			}
		});
		expect(lua_pcall(L, 1, 0, 0)).toBe(LUA_ERRRUN);
		expect(tojs(L, -1)).toEqual(expect.stringContaining("bad '__pairs' result"));
		lua_pop(L, 1);

		lua_pushvalue(L, -1);
		push(L, {
			[Symbol.for("__pairs")]: function() {
				return {
					iter: function() {
						return "invalid result";
					}
				}
			}
		});
		expect(lua_pcall(L, 1, 0, 0)).toBe(LUA_ERRRUN);
		expect(tojs(L, -1)).toEqual(expect.stringContaining("bad iterator result"));
		lua_pop(L, 1);
	});

	describe("js.createproxy implements all proxy methods", function() {
		it("implements get/__index", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local iscalled = false
			function mt:__index(k)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(k == "foo", "wrong key")
				return "bar"
			end
			assert(x.foo == "bar")
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements has/__index", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local iscalled = false
			function mt:__index(k)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(k == "foo", "wrong key")
				return "bar"
			end
			assert(js.global.Reflect:has(x, "foo"))
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements set/__newindex", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local iscalled = false
			function mt:__newindex(k, v)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(k == "foo", "wrong key")
				assert(v == "bar", "wrong value")
			end
			x.foo = "bar"
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements delete", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local iscalled = false
			-- delete is just a set to nil.
			function mt:__newindex(k, v)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(k == "foo", "wrong key")
				assert(v == nil, "wrong value")
			end
			js.global.Reflect:deleteProperty(x, "foo")
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements apply/__call", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			-- Try empty first
			local ok, err = pcall(x, 1, 2, 3, 4, 5)
			assert(not ok)
			assert(err:match "attempt to call a table value")

			local iscalled = false
			function mt:__call(...)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(select("#", ...) == 5, "wrong number of args")
				local a, b, c, d, e = ...
				assert(a == 1)
				assert(b == 2)
				assert(c == 3)
				assert(d == 4)
				assert(e == 5)
			end
			x(1, 2, 3, 4, 5)
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements defineProperty", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local prop = js.new(js.global.Object)

			-- Try empty first
			assert(js.global.Reflect:defineProperty(x, "foo", prop) == false)

			local iscalled = false
			function mt:defineProperty(k, property)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(k == "foo", "wrong key")
				return true
			end
			assert(js.global.Reflect:defineProperty(x, "foo", prop) == true)
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements getOwnPropertyDescriptor", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			-- Try empty first
			assert(js.global.Reflect:getOwnPropertyDescriptor(x, "foo") == nil)

			local iscalled = false
			function mt:getOwnPropertyDescriptor(k)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(k == "foo", "wrong key")
				local prop = js.new(js.global.Object)
				prop.configurable = true
				return prop
			end
			assert(js.global.Reflect:getOwnPropertyDescriptor(x, "foo").configurable == true)
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements getPrototypeOf", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			-- Try empty first
			assert(js.global.Reflect:getPrototypeOf(x) == js.null)

			local iscalled = false
			local proto = {}
			function mt:getPrototypeOf()
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				return proto
			end
			assert(js.global.Reflect:getPrototypeOf(x) == proto)
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements setPrototypeOf", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local proto = {}

			-- Try empty first
			assert(js.global.Reflect:setPrototypeOf(x, proto) == false, "expected false")

			local iscalled = false
			function mt:setPrototypeOf(newproto)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(newproto == proto, "wrong new prototype")
				return true
			end
			assert(js.global.Reflect:setPrototypeOf(x, proto) == true, "expected true")
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it.skip("implements construct", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			local iscalled = false
			function mt:construct(...)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				assert(select("#", ...) == 5, "wrong number of args")
				local a, b, c, d, e = ...
				assert(a == 1)
				assert(b == 2)
				assert(c == 3)
				assert(d == 4)
				assert(e == 5)
				return {}
			end
			js.new(x, 1, 2, 3, 4, 5)
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});

		it("implements ownKeys", function() {
			const L = new_state();
			if (luaL_dostring(L, to_luastring(`
			local js = require "js"
			local t = {}
			local mt = {}
			setmetatable(t, mt)
			local x = js.createproxy(t)

			-- Try empty first
			assert(not pcall(js.global.Reflect.ownKeys, nil, x), "ownKeys doesn't work by default")

			local iscalled = false
			function mt:ownKeys(...)
				iscalled = true
				assert(rawequal(self, t), "wrong self")
				return js.global.Array:of("foo", "bar")
			end
			local a = js.global.Reflect:ownKeys(x)
			assert(a[0] == "foo")
			assert(a[1] == "bar")
			assert(iscalled)
			`)) !== LUA_OK) {
				throw tojs(L, -1);
			}
		});
	});
});