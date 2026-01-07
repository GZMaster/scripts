// Name: Search on Youtube
// Author: Ricardo Gonçalves Bassete

import "@johnlindquist/kit"

const keyword = await arg('Search Youtube...')
const searchURL = `https://www.youtube.com/results?search_query=${keyword.toLowerCase().trim().replaceAll(' ', '+')}`

open(searchURL)