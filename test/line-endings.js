var _ = require('lodash');
var expect = require('chai').expect;
var fs = require('fs');
var rl = require('../index');

// Loop over example files with different encodings which all should pass identical tests
var files = ['/data/language-LF.nbib', '/data/language-CRLF.nbib'];
for (var i in files) {

    describe('MEDLINE line endings compatibility test -  case:' + files[i], function () {
        var resErr;
        var data = {};
        // copy the filename, to prevent using reference to changing global string object to the async before()
        var filename = '' + files[i]; 

        before(function (next) {
            this.timeout(60 * 1000);
            rl.parse(fs.readFileSync(__dirname + filename, 'utf-8'))
                .on('error', function (err) {
                    resErr = err;
                    next();
                })
                .on('ref', function (ref) {
                    data[ref.recNo] = ref;
                })
                .on('end', next);
        });

        it('should not raise an error', function () {
            expect(resErr).to.be.not.ok;
        });

        it('end count should be accurate', function () {
            expect(_.keys(data)).to.have.length(40);
        });

        it('should return random sample', function () {
            var sample = data['280219'];
            expect(sample).to.be.ok;
            expect(sample).to.have.property('title', 'An anthropological perspective on the evolution and lateralization of the brain.');
            expect(sample).to.have.property('journal', 'Annals of the New York Academy of Sciences');
            expect(sample).to.have.property('authors');
            expect(sample.authors).to.deep.equal(['Dawson, J L']);
            expect(sample).to.have.property('date', '1977 Sep 30');
            expect(sample).to.have.property('type', 'unknown');
            expect(sample).to.have.property('language', 'eng');
            expect(sample).to.have.property('abstract');
            expect(sample.abstract).to.match(/^The purpose of this paper/);
            expect(sample.abstract).to.match(/The next section, concerned with/);
            expect(sample.abstract).to.match(/within and across cultures\.$/);
            // expect(sample.keywords).to.deep.equal(['', 'No keywords']);
            expect(sample).to.have.property('doi', '10.1111/j.1749-6632.1977.tb41927.x [doi]');
        });
    });
}
