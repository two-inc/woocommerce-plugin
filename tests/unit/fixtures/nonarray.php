<?php

/**
 * Deliberately malformed brand fixture (returns a string, not an array)
 * for asserting the loader degrades to defaults instead of fatalling.
 */

return 'not-an-array';
