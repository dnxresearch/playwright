/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const Location = require('./Location');
const { Test, Suite } = require('./Test');
const { TestRun } = require('./TestRunner');

class FocusedFilter {
  constructor() {
    this._focused = new Set();
  }

  markFocused(testOrSuite) {
    this._focused.add(testOrSuite);
  }

  hasFocusedTestsOrSuites() {
    return !!this._focused.size;
  }

  focusedTests(tests) {
    return tests.filter(test => this._focused.has(test));
  }

  focusedSuites(suites) {
    return suites.filter(suite => this._focused.has(suite));
  }

  filter(tests) {
    if (!this.hasFocusedTestsOrSuites())
      return tests;

    const ignoredSuites = new Set();
    for (const test of tests) {
      if (this._focused.has(test)) {
        // Focused tests should be run even if skipped.
        test.setSkipped(false);
        // TODO: remove next line once we run failing tests.
        test.setExpectation(test.Expectations.Ok);
      }
      for (let suite = test.suite(); suite; suite = suite.parentSuite()) {
        if (this._focused.has(suite)) {
          // Focused suites should be run even if skipped.
          suite.setSkipped(false);
          // TODO: remove next line once we run failing tests.
          suite.setExpectation(suite.Expectations.Ok);
        }
        // Mark parent suites of focused tests as ignored.
        if (this._focused.has(test))
          ignoredSuites.add(suite);
      }
    }
    // Pick all tests that are focused or belong to focused suites.
    const result = [];
    for (const test of tests) {
      let focused = this._focused.has(test);
      for (let suite = test.suite(); suite; suite = suite.parentSuite())
        focused = focused || (this._focused.has(suite) && !ignoredSuites.has(suite));
      if (focused)
        result.push(test);
    }
    return result;
  }
}

class Repeater {
  constructor() {
    this._repeatCount = new Map();
  }

  repeat(testOrSuite, count) {
    this._repeatCount.set(testOrSuite, count);
  }

  _get(testOrSuite) {
    const repeat = this._repeatCount.get(testOrSuite);
    return repeat === undefined ? 1 : repeat;
  }

  createTestRuns(tests) {
    const testRuns = [];
    for (const test of tests) {
      let repeat = this._get(test);
      for (let suite = test.suite(); suite; suite = suite.parentSuite())
        repeat *= this._get(suite);
      for (let i = 0; i < repeat; i++)
        testRuns.push(new TestRun(test));
    }
    return testRuns;
  }
}

function specBuilder(modifiers, attributes, specCallback) {
  function builder(specs) {
    return new Proxy((...args) => specCallback(specs, ...args), {
      get: (obj, prop) => {
        if (modifiers.has(prop))
          return (...args) => builder([...specs, { callback: modifiers.get(prop), args }]);
        if (attributes.has(prop))
          return builder([...specs, { callback: attributes.get(prop), args: [] }]);
        return obj[prop];
      },
    });
  }
  return builder([]);
}

class TestCollector {
  constructor(options = {}) {
    let { timeout = 10 * 1000 } = options;
    if (timeout === 0)
      timeout = 100000000;  // Inifinite timeout.

    this._tests = [];
    this._suites = [];
    this._suiteModifiers = new Map();
    this._suiteAttributes = new Map();
    this._testModifiers = new Map();
    this._testAttributes = new Map();
    this._api = {};

    this._currentSuite = new Suite(null, '', new Location());

    this._api.describe = specBuilder(this._suiteModifiers, this._suiteAttributes, (specs, name, suiteCallback, ...suiteArgs) => {
      const location = Location.getCallerLocation();
      const suite = new Suite(this._currentSuite, name, location);
      for (const { callback, args } of specs)
        callback(suite, ...args);
      this._currentSuite = suite;
      suiteCallback(...suiteArgs);
      this._suites.push(suite);
      this._currentSuite = suite.parentSuite();
    });
    this._api.it = specBuilder(this._testModifiers, this._testAttributes, (specs, name, testCallback) => {
      const location = Location.getCallerLocation();
      const test = new Test(this._currentSuite, name, testCallback, location);
      test.setTimeout(timeout);
      for (const { callback, args } of specs)
        callback(test, ...args);
      this._tests.push(test);
    });
    this._api.beforeAll = callback => this._currentSuite.environment().beforeAll(callback);
    this._api.beforeEach = callback => this._currentSuite.environment().beforeEach(callback);
    this._api.afterAll = callback => this._currentSuite.environment().afterAll(callback);
    this._api.afterEach = callback => this._currentSuite.environment().afterEach(callback);
  }

  useEnvironment(environment) {
    return this._currentSuite.addEnvironment(environment);
  }

  addTestModifier(name, callback) {
    this._testModifiers.set(name, callback);
  }

  addTestAttribute(name, callback) {
    this._testAttributes.set(name, callback);
  }

  addSuiteModifier(name, callback) {
    this._suiteModifiers.set(name, callback);
  }

  addSuiteAttribute(name, callback) {
    this._suiteAttributes.set(name, callback);
  }

  api() {
    return this._api;
  }

  tests() {
    return this._tests;
  }

  suites() {
    return this._suites;
  }
}

module.exports = { TestCollector, specBuilder, FocusedFilter, Repeater };
